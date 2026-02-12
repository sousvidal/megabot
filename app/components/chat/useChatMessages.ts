import { useState, useEffect, useRef } from "react";
import type { StreamPart } from "./MessageBubble";
import type { ToolCallState } from "./ToolCallCard";

interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  model?: string | null;
  createdAt: Date;
  streamParts?: StreamPart[];
}

type ChunkHandler = (
  chunk: Record<string, unknown>,
  context: {
    assistantId: string;
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
    setError: (error: string) => void;
    toolCallMap: Map<string, ToolCallState>;
  }
) => void;

function updateToolCallInParts(
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  msgId: string,
  toolCallId: string,
  updates: Partial<ToolCallState>
) {
  setMessages((prev) =>
    prev.map((m) => {
      if (m.id !== msgId || !m.streamParts) return m;
      const parts = m.streamParts.map((p) => {
        if (p.type === "tool_call" && p.toolCall.id === toolCallId) {
          return {
            type: "tool_call" as const,
            toolCall: { ...p.toolCall, ...updates },
          };
        }
        return p;
      });
      return { ...m, streamParts: parts };
    })
  );
}

const handleTextChunk: ChunkHandler = (chunk, { assistantId, setMessages }) => {
  const text = chunk.text as string;
  if (!text) return;

  setMessages((prev) =>
    prev.map((m) => {
      if (m.id !== assistantId) return m;
      const parts = [...(m.streamParts ?? [])];
      const lastPart = parts[parts.length - 1];
      if (lastPart && lastPart.type === "text") {
        parts[parts.length - 1] = {
          type: "text",
          content: lastPart.content + text,
        };
      } else {
        parts.push({ type: "text", content: text });
      }
      return {
        ...m,
        content: m.content + text,
        streamParts: parts,
      };
    })
  );
};

const handleToolCallStart: ChunkHandler = (
  chunk,
  { assistantId, setMessages, toolCallMap }
) => {
  const toolCall: ToolCallState = {
    id: chunk.toolCallId as string,
    name: chunk.toolName as string,
    args: "",
    status: "calling",
  };
  toolCallMap.set(toolCall.id, toolCall);
  setMessages((prev) =>
    prev.map((m) => {
      if (m.id !== assistantId) return m;
      const parts = [...(m.streamParts ?? [])];
      parts.push({ type: "tool_call", toolCall });
      return { ...m, streamParts: parts };
    })
  );
};

const handleToolCallDelta: ChunkHandler = (
  chunk,
  { assistantId, setMessages, toolCallMap }
) => {
  const id = chunk.toolCallId as string;
  const tc = toolCallMap.get(id);
  if (!tc) return;
  tc.args += chunk.text as string;
  updateToolCallInParts(setMessages, assistantId, id, { args: tc.args });
};

const handleToolCallEnd: ChunkHandler = (
  chunk,
  { assistantId, setMessages, toolCallMap }
) => {
  const id = chunk.toolCallId as string;
  const tc = toolCallMap.get(id);
  if (!tc) return;
  tc.args = (chunk.toolArgs as string) ?? tc.args;
  tc.status = "executing";
  updateToolCallInParts(setMessages, assistantId, id, {
    args: tc.args,
    status: "executing",
  });
};

const handleToolExecuting: ChunkHandler = (
  chunk,
  { assistantId, setMessages, toolCallMap }
) => {
  const id = chunk.toolCallId as string;
  const tc = toolCallMap.get(id);
  if (!tc) return;
  tc.status = "executing";
  updateToolCallInParts(setMessages, assistantId, id, { status: "executing" });
};

const handleToolResult: ChunkHandler = (
  chunk,
  { assistantId, setMessages, toolCallMap }
) => {
  const id = chunk.toolCallId as string;
  const tc = toolCallMap.get(id);
  if (!tc) return;
  const result = chunk.toolResult as {
    content: string;
    isError: boolean;
  };
  tc.status = "done";
  tc.result = result;
  updateToolCallInParts(setMessages, assistantId, id, {
    status: "done",
    result,
  });
};

const handleErrorChunk: ChunkHandler = (chunk, { setError }) => {
  setError((chunk.error as string) || "An error occurred");
};

const CHUNK_HANDLERS: Record<string, ChunkHandler> = {
  text: handleTextChunk,
  tool_call_start: handleToolCallStart,
  tool_call_delta: handleToolCallDelta,
  tool_call_end: handleToolCallEnd,
  tool_executing: handleToolExecuting,
  tool_result: handleToolResult,
  error: handleErrorChunk,
};

async function processStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  assistantId: string,
  toolCallMap: Map<string, ToolCallState>,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  setError: (error: string) => void
) {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") continue;

      try {
        const chunk = JSON.parse(payload) as Record<string, unknown>;
        const type = chunk.type as string;
        const handler = CHUNK_HANDLERS[type];

        if (handler) {
          handler(chunk, {
            assistantId,
            setMessages,
            setError,
            toolCallMap,
          });
        }
      } catch {
        // Ignore malformed JSON
      }
    }
  }
}

/**
 * Connect to an active SSE stream for reconnection after page refresh.
 * Returns a cleanup function that closes the EventSource.
 */
function connectToStream(
  conversationId: string,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  setIsStreaming: (streaming: boolean) => void,
  setError: (error: string | null) => void
): () => void {
  const assistantId = `reconnect-${Date.now()}`;
  const toolCallMap = new Map<string, ToolCallState>();
  let closed = false;
  let assistantMessageAdded = false;

  setIsStreaming(true);

  const eventSource = new EventSource(`/api/chat/${conversationId}/stream`);

  const closeStream = () => {
    if (!closed) {
      closed = true;
      eventSource.close();
      setIsStreaming(false);
    }
  };

  eventSource.onmessage = (event: MessageEvent) => {
    if (closed) return;
    const payload = event.data as string;

    if (payload === "[DONE]") {
      closeStream();
      return;
    }

    try {
      const chunk = JSON.parse(payload) as Record<string, unknown>;
      const type = chunk.type as string;
      if (type === "meta") return;

      // Add the assistant message on the first real chunk so it
      // doesn't race with useSyncInitialMessages
      if (!assistantMessageAdded) {
        assistantMessageAdded = true;
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: "assistant" as const,
            content: "",
            createdAt: new Date(),
            streamParts: [{ type: "text" as const, content: "" }],
          },
        ]);
      }

      const handler = CHUNK_HANDLERS[type];
      if (handler) {
        handler(chunk, {
          assistantId,
          setMessages,
          setError: (e: string) => setError(e),
          toolCallMap,
        });
      }

      if (type === "done") {
        closeStream();
      }
    } catch {
      // Ignore parse errors (e.g. heartbeat comments)
    }
  };

  eventSource.onerror = () => {
    closeStream();
  };

  return closeStream;
}

export function useChatMessages(conversationId: string, isStreamActive?: boolean) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reconnectedRef = useRef(false);
  const sentMessageRef = useRef(false);

  // Reset reconnect state when conversation changes
  useEffect(() => {
    reconnectedRef.current = false;
    sentMessageRef.current = false;
  }, [conversationId]);

  // Auto-reconnect to an active stream after page refresh
  useEffect(() => {
    const shouldSkip = !isStreamActive || reconnectedRef.current ||
      sentMessageRef.current || messages.some((m) => m.id.startsWith("temp-assistant-"));
    if (shouldSkip) return;
    reconnectedRef.current = true;
    return connectToStream(conversationId, setMessages, setIsStreaming, setError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, isStreamActive]);

  async function sendMessage(text: string, onComplete?: () => void) {
    sentMessageRef.current = true;
    setError(null);
    setIsStreaming(true);

    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);

    const assistantId = `temp-assistant-${Date.now()}`;
    const assistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: new Date(),
      streamParts: [{ type: "text", content: "" }],
    };
    setMessages((prev) => [...prev, assistantMessage]);

    const toolCallMap = new Map<string, ToolCallState>();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: text }),
      });

      if (!response.ok) {
        const err = (await response.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to send message");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      await processStream(reader, assistantId, toolCallMap, setMessages, setError);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to send message";
      setError(msg);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.id === assistantId && !last.content) {
          return prev.slice(0, -1);
        }
        return prev;
      });
    } finally {
      setIsStreaming(false);
      onComplete?.();
    }
  }

  return {
    messages,
    setMessages,
    isStreaming,
    error,
    setError,
    sendMessage,
  };
}
