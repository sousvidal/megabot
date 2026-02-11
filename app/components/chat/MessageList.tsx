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
  error: string | null;
  scrollRef: React.RefObject<HTMLDivElement>;
}

export function MessageList({
  messages,
  isStreaming,
  error,
  scrollRef,
}: MessageListProps) {
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
