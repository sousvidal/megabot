import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "~/components/ui/button";
import { MessageBubble } from "./MessageBubble";
import { Send, Loader2 } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  model?: string | null;
  createdAt: Date;
}

interface ChatWindowProps {
  conversationId: string;
  initialMessages: Message[];
  /** If provided, this message is sent automatically on mount (new conversation flow). */
  initialMessage?: string;
  onStreamComplete?: () => void;
}

export function ChatWindow({
  conversationId,
  initialMessages,
  initialMessage,
  onStreamComplete,
}: ChatWindowProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const initialMessageSent = useRef(false);

  // Sync messages when conversation changes (navigation between conversations)
  useEffect(() => {
    setMessages(initialMessages);
    setError(null);
  }, [initialMessages]);

  // Auto-scroll to bottom when messages change
  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Auto-send the initial message for new conversations
  useEffect(() => {
    if (initialMessage && !initialMessageSent.current) {
      initialMessageSent.current = true;
      sendMessage(initialMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage]);

  async function sendMessage(text: string) {
    setError(null);
    setIsStreaming(true);

    // Optimistically add user message
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Add placeholder assistant message
    const assistantId = `temp-assistant-${Date.now()}`;
    const assistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: text }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to send message");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

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
            const chunk = JSON.parse(payload);

            if (chunk.type === "text" && chunk.text) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + chunk.text }
                    : m
                )
              );
            } else if (chunk.type === "error") {
              setError(chunk.error || "An error occurred");
            }
          } catch {
            // Ignore malformed JSON
          }
        }
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to send message";
      setError(msg);
      // Remove the empty assistant message on complete failure
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.id === assistantId && !last.content) {
          return prev.slice(0, -1);
        }
        return prev;
      });
    } finally {
      setIsStreaming(false);
      onStreamComplete?.();
      inputRef.current?.focus();
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    sendMessage(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 p-4 pb-8">
          {messages
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((message) => (
              <MessageBubble
                key={message.id}
                role={message.role}
                content={message.content}
                isStreaming={
                  isStreaming &&
                  message.role === "assistant" &&
                  message.id.startsWith("temp-assistant-")
                }
              />
            ))}

          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Scroll anchor */}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border bg-background p-4">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-border bg-card p-2 shadow-sm"
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            rows={1}
            className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
            disabled={isStreaming}
            autoFocus
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || isStreaming}
          >
            {isStreaming ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
