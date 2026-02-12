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
  isProcessing?: boolean;
  onStreamComplete?: () => void;
}

function useNotificationSubscription(
  conversationId: string,
  onStreamComplete?: () => void
) {
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
          
          if (
            conversationIdValue === conversationId &&
            (data.type === "agent.completed" ||
              data.type === "agent.error" ||
              data.type === "chat.completed")
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
}

function useSyncInitialMessages(
  initialMessages: Message[],
  isStreaming: boolean,
  setMessages: (messages: Message[]) => void,
  setError: (error: string | null) => void
) {
  const prevInitialMessages = useRef<Message[]>([]);

  useEffect(() => {
    const messagesChanged = initialMessages.length !== prevInitialMessages.current.length ||
      initialMessages.some((msg, i) => msg.id !== prevInitialMessages.current[i]?.id);
    
    console.warn("[ChatWindow] initialMessages effect:", 
      "count=", initialMessages.length, 
      "isStreaming=", isStreaming,
      "changed=", messagesChanged
    );
    
    if (messagesChanged && !isStreaming) {
      console.warn("[ChatWindow] SYNCING initialMessages to state");
      setMessages(initialMessages);
      setError(null);
      prevInitialMessages.current = initialMessages;
    } else {
      console.warn("[ChatWindow] SKIPPING sync:", 
        "changed=", messagesChanged, 
        "isStreaming=", isStreaming
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessages, isStreaming]);
}

export function ChatWindow({
  conversationId,
  initialMessages,
  initialMessage,
  isProcessing,
  onStreamComplete,
}: ChatWindowProps) {
  const {
    messages,
    setMessages,
    isStreaming,
    error,
    setError,
    sendMessage: sendChatMessage,
  } = useChatMessages(conversationId, isProcessing);

  const bottomRef = useRef<HTMLDivElement>(null);
  const initialMessageSent = useRef(false);

  useSyncInitialMessages(initialMessages, isStreaming, setMessages, setError);

  useEffect(() => {
    console.warn("[ChatWindow] RENDER:", 
      "msgCount=", messages.length,
      "ids=", messages.map(m => m.id).join(","),
      "isStreaming=", isStreaming, 
      "isProcessing=", isProcessing
    );
  }, [messages, isStreaming, isProcessing]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    console.log("[ChatWindow] initialMessage effect:", { initialMessage, sent: initialMessageSent.current });
    if (initialMessage && !initialMessageSent.current) {
      initialMessageSent.current = true;
      window.history.replaceState({}, "", window.location.pathname);
      void sendChatMessage(initialMessage, onStreamComplete);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage]);

  useNotificationSubscription(conversationId, onStreamComplete);

  function handleSendMessage(text: string) {
    void sendChatMessage(text, onStreamComplete);
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        isProcessing={isProcessing}
        error={error}
        scrollRef={bottomRef}
      />
      <ChatInput onSendMessage={handleSendMessage} isStreaming={isStreaming || !!isProcessing} />
    </div>
  );
}
