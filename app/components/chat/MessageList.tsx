import { useEffect } from "react";
import { MessageBubble, type StreamPart } from "./MessageBubble";

interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  model?: string | null;
  createdAt: Date;
  streamParts?: StreamPart[];
}

interface MessageListProps {
  messages: Message[];
  isStreaming: boolean;
  isProcessing?: boolean;
  error: string | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export function MessageList({
  messages,
  isStreaming,
  isProcessing,
  error,
  scrollRef,
}: MessageListProps) {
  useEffect(() => {
    console.warn("[MessageList] RENDER:", 
      "count=", messages.length,
      "ids=", messages.map(m => `${m.role}:${m.id.substring(0,8)}`).join(","),
      "isStreaming=", isStreaming, 
      "isProcessing=", isProcessing
    );
  }, [messages, isStreaming, isProcessing]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-4 pb-8">
        {messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((message) => (
            <MessageBubble
              key={message.id}
              role={message.role}
              content={message.content}
              streamParts={message.streamParts}
              isStreaming={
                isStreaming &&
                message.role === "assistant" &&
                message.id.startsWith("temp-assistant-")
              }
            />
          ))}

        {isProcessing && !isStreaming && (
          <div className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground">
            <span className="inline-flex gap-1">
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
            </span>
            Agent is thinking...
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={scrollRef} />
      </div>
    </div>
  );
}
