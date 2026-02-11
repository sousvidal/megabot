import { useRef, useEffect, useCallback } from "react";
import { useChatMessages } from "./useChatMessages";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import type { StreamPart } from "./MessageBubble";

interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  model?: string | null;
  createdAt: Date;
  streamParts?: StreamPart[];
}

interface ChatWindowProps {
  conversationId: string;
  initialMessages: Message[];
  initialMessage?: string;
  onStreamComplete?: () => void;
}

export function ChatWindow({
  conversationId,
  initialMessages,
  initialMessage,
  onStreamComplete,
}: ChatWindowProps) {
  const {
    messages,
    setMessages,
    isStreaming,
    error,
    setError,
    sendMessage: sendChatMessage,
  } = useChatMessages(conversationId);

  const bottomRef = useRef<HTMLDivElement>(null);
  const initialMessageSent = useRef(false);

  useEffect(() => {
    setMessages(initialMessages);
    setError(null);
  }, [initialMessages, setMessages, setError]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (initialMessage && !initialMessageSent.current) {
      initialMessageSent.current = true;
      void sendChatMessage(initialMessage, onStreamComplete);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage]);

  // Subscribe to notification SSE for background agent results
  useEffect(() => {
    const eventSource = new EventSource("/api/notifications");

    eventSource.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as unknown;
        
        if (
          data &&
          typeof data === "object" &&
          "type" in data &&
          typeof data.type === "string"
        ) {
          const conversationIdValue =
            "conversationId" in data && typeof data.conversationId === "string"
              ? data.conversationId
              : undefined;
          
          // If the event is for our conversation, trigger a revalidation
          if (
            conversationIdValue === conversationId &&
            (data.type === "agent.completed" || data.type === "agent.error")
          ) {
            onStreamComplete?.();
          }
        }
      } catch {
        // Ignore parse errors (e.g. heartbeat comments)
      }
    };

    return () => {
      eventSource.close();
    };
  }, [conversationId, onStreamComplete]);

  function handleSendMessage(text: string) {
    void sendChatMessage(text, onStreamComplete);
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        error={error}
        scrollRef={bottomRef}
      />
      <ChatInput onSendMessage={handleSendMessage} isStreaming={isStreaming} />
    </div>
  );
}
