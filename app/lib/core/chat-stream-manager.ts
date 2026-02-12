import type { LLMChunk } from "~/lib/types";
import type { EventBus } from "./event-bus";
import { logger } from "~/lib/logger";

const log = logger.child({ module: "chat-stream-manager" });

type ChunkCallback = (chunk: LLMChunk) => void;

interface ActiveStream {
  chunks: LLMChunk[];
  subscribers: Set<ChunkCallback>;
  done: boolean;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

const BUFFER_TTL_MS = 60_000;

export class ChatStreamManager {
  private streams = new Map<string, ActiveStream>();

  /**
   * Start consuming an async generator in the background.
   * The generator keeps running even if all subscribers disconnect.
   */
  startStream(
    conversationId: string,
    generator: AsyncGenerator<LLMChunk>,
    eventBus: EventBus
  ): void {
    // If there's a stale completed stream, clean it up first
    const existing = this.streams.get(conversationId);
    if (existing?.done) {
      if (existing.cleanupTimer) clearTimeout(existing.cleanupTimer);
      this.streams.delete(conversationId);
    }

    const stream: ActiveStream = {
      chunks: [],
      subscribers: new Set(),
      done: false,
    };
    this.streams.set(conversationId, stream);

    // Detached — not awaited, runs independently of any HTTP response
    void (async () => {
      try {
        for await (const chunk of generator) {
          stream.chunks.push(chunk);
          for (const cb of stream.subscribers) {
            try {
              cb(chunk);
            } catch {
              // subscriber error — ignore
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        log.error({ conversationId, error: msg }, "Background stream failed");
      } finally {
        stream.done = true;
        stream.subscribers.clear();
        eventBus.emit("chat.completed", "chat-stream-manager", {}, { conversationId });
        log.info({ conversationId }, "Background stream completed");

        // Clean up buffer after TTL
        stream.cleanupTimer = setTimeout(() => {
          this.streams.delete(conversationId);
        }, BUFFER_TTL_MS);
      }
    })();
  }

  /**
   * Subscribe to a stream's chunks. Replays buffered chunks immediately,
   * then delivers live chunks. Returns an unsubscribe function.
   */
  subscribe(conversationId: string, callback: ChunkCallback): () => void {
    const stream = this.streams.get(conversationId);
    if (!stream) return () => {};

    // Replay buffered chunks
    for (const chunk of stream.chunks) {
      try {
        callback(chunk);
      } catch {
        // subscriber error — ignore
      }
    }

    // If already done, nothing more to deliver
    if (stream.done) return () => {};

    // Subscribe for live chunks
    stream.subscribers.add(callback);
    return () => {
      stream.subscribers.delete(callback);
    };
  }

  /** Returns true if a stream is currently running for this conversation. */
  isActive(conversationId: string): boolean {
    const stream = this.streams.get(conversationId);
    return stream !== undefined && !stream.done;
  }

  /** Returns true if buffered data exists (active or recently completed). */
  hasBuffer(conversationId: string): boolean {
    return this.streams.has(conversationId);
  }

  /**
   * Subscribe starting from the current (unfinished) turn.
   * Replays chunks from after the last completed tool-call round,
   * then delivers live chunks. Useful for reconnecting after a page
   * refresh — the DB already has completed turns, so we only need
   * chunks from the in-progress turn.
   */
  subscribeFromCurrentTurn(
    conversationId: string,
    callback: ChunkCallback
  ): () => void {
    const stream = this.streams.get(conversationId);
    if (!stream) return () => {};

    // If the stream is already done, everything is persisted in the DB.
    // Don't replay — the loader already returned the complete messages.
    if (stream.done) return () => {};

    const startIndex = this.getCurrentTurnStartIndex(stream.chunks);

    // Replay from current turn
    for (let i = startIndex; i < stream.chunks.length; i++) {
      try {
        callback(stream.chunks[i]);
      } catch {
        // subscriber error — ignore
      }
    }

    if (stream.done) return () => {};

    stream.subscribers.add(callback);
    return () => {
      stream.subscribers.delete(callback);
    };
  }

  /**
   * Find the index where the current (unfinished) turn starts.
   * A turn boundary is defined as the first text or tool_call_start
   * chunk that appears after the last tool_result chunk.
   */
  private getCurrentTurnStartIndex(chunks: LLMChunk[]): number {
    let lastToolResultIdx = -1;
    for (let i = chunks.length - 1; i >= 0; i--) {
      if (chunks[i].type === "tool_result") {
        lastToolResultIdx = i;
        break;
      }
    }

    for (let i = lastToolResultIdx + 1; i < chunks.length; i++) {
      const type = chunks[i].type;
      if (type === "text" || type === "tool_call_start") {
        return i;
      }
    }

    // No current turn content yet — only live chunks will be delivered
    return chunks.length;
  }
}
