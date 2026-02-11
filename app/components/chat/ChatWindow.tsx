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
      sendChatMessage(initialMessage, onStreamComplete);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage]);

  function handleSendMessage(text: string) {
    sendChatMessage(text, onStreamComplete);
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
