import { useState } from "react";
import { useNavigate } from "react-router";
import { nanoid } from "nanoid";
import { Button } from "~/components/ui/button";
import { Bot, Send } from "lucide-react";

export default function ChatIndex() {
  const [message, setMessage] = useState("");
  const navigate = useNavigate();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = message.trim();
    if (!text) return;

    // Generate a conversation ID client-side and navigate immediately.
    // The ChatWindow on the target page handles sending the first message.
    const conversationId = nanoid();
    navigate(`/chat/${conversationId}`, {
      state: { initialMessage: text },
    });
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="flex flex-col items-center gap-3">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Bot className="size-8" />
        </div>
        <h1 className="text-2xl font-semibold text-foreground">MegaBot</h1>
        <p className="max-w-md text-center text-muted-foreground">
          Your personal AI assistant. Ask me anything, or give me a task to work
          on.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-2xl items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-sm"
      >
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Send a message..."
          className="flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
          autoFocus
        />
        <Button type="submit" size="icon" disabled={!message.trim()}>
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
