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
}
