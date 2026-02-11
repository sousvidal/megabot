import { useLoaderData, useRevalidator, useLocation } from "react-router";
import { eq, asc } from "drizzle-orm";
import { getServer } from "~/lib/server/init";
import { messages, conversations } from "~/lib/db/schema";
import { ChatWindow } from "~/components/chat/ChatWindow";
import type { Route } from "./+types/chat.$id";

export async function loader({ params }: Route.LoaderArgs) {
  const server = getServer();
  const conversationId = params.id;

  const conversation = server.db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .get();

  // Don't 404 — this may be a new conversation that hasn't been persisted yet.
  // The ChatWindow will create it via the API when the first message is sent.
  const msgs = conversation
    ? server.db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.createdAt))
        .all()
    : [];

  return { conversationId, messages: msgs };
}

export default function ChatConversation() {
  const { conversationId, messages: initialMessages } =
    useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const location = useLocation();

  // Pick up the initial message from navigation state (new conversation flow)
  const initialMessage = (location.state as { initialMessage?: string })
    ?.initialMessage;

  return (
    <ChatWindow
      conversationId={conversationId}
      initialMessages={initialMessages}
      initialMessage={initialMessage}
      onStreamComplete={() => revalidator.revalidate()}
    />
  );
}
