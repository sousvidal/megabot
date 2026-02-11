import { useMemo } from "react";
import { useLoaderData, useRevalidator, useLocation } from "react-router";
import { eq, asc } from "drizzle-orm";
import { getServer } from "~/lib/server/init";
import { messages, conversations } from "~/lib/db/schema";
import { ChatWindow } from "~/components/chat/ChatWindow";
import type { Route } from "./+types/chat.$id";
import type { StreamPart } from "~/components/chat/MessageBubble";
import type { ContentBlock, ToolResultBlock } from "~/lib/types";

export function loader({ params }: Route.LoaderArgs) {
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

  const isProcessing = server.chatStreamManager.isActive(conversationId);

  return { conversationId, messages: msgs, isProcessing };
}

/**
 * Reconstruct display messages from DB rows.
 * Merges assistant tool-call messages with their tool results
 * into streamParts so tool cards render from persisted data.
 */
function buildDisplayMessages(
  rows: Array<{
    id: string;
    role: string;
    content: string;
    toolCalls: string | null;
    model: string | null;
    createdAt: Date;
  }>
) {
  const result: Array<{
    id: string;
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    model?: string | null;
    createdAt: Date;
    streamParts?: StreamPart[];
  }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    // Skip tool-result messages — they get merged into the preceding assistant message
    if (row.role === "tool") continue;

    // Regular user or system message
    if (row.role !== "assistant" || !row.toolCalls) {
      result.push({
        id: row.id,
        role: row.role as "user" | "assistant" | "system",
        content: row.content,
        model: row.model,
        createdAt: row.createdAt,
      });
      continue;
    }

    // Assistant message with tool calls — reconstruct streamParts
    const blocks = JSON.parse(row.toolCalls) as ContentBlock[];
    const parts: StreamPart[] = [];

    // Build parts from content blocks
    for (const block of blocks) {
      if (block.type === "text" && block.text) {
        parts.push({ type: "text", content: block.text });
      } else if (block.type === "tool_use") {
        // Look ahead for the tool result in the next message
        const nextRow = rows[i + 1];
        let toolResult: { content: string; isError: boolean } | undefined;

        if (nextRow?.role === "tool" && nextRow.toolCalls) {
          const resultBlocks = JSON.parse(
            nextRow.toolCalls
          ) as ToolResultBlock[];
          const match = resultBlocks.find((r) => r.toolUseId === block.id);
          if (match) {
            toolResult = {
              content: match.content,
              isError: match.isError ?? false,
            };
          }
        }

        parts.push({
          type: "tool_call",
          toolCall: {
            id: block.id,
            name: block.name,
            args: JSON.stringify(block.input),
            status: "done",
            result: toolResult,
          },
        });
      }
    }

    // If there are no text blocks, add an empty one so the bubble isn't empty
    // (the tool cards will render inside it)
    if (!parts.some((p) => p.type === "text")) {
      parts.unshift({ type: "text", content: "" });
    }

    result.push({
      id: row.id,
      role: "assistant",
      content: row.content,
      model: row.model,
      createdAt: row.createdAt,
      streamParts: parts,
    });
  }

  return result;
}

export default function ChatConversation() {
  const { conversationId, messages: rawMessages, isProcessing } =
    useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const location = useLocation();

  // Pick up the initial message from navigation state (new conversation flow).
  // Guard: only use it if the conversation has no messages yet (prevents
  // re-sending on refresh — location.state persists across browser refreshes).
  const initialMessage =
    rawMessages.length === 0
      ? (location.state as { initialMessage?: string })?.initialMessage
      : undefined;

  const displayMessages = useMemo(
    () => buildDisplayMessages(rawMessages),
    [rawMessages]
  );

  return (
    <ChatWindow
      conversationId={conversationId}
      initialMessages={displayMessages}
      initialMessage={initialMessage}
      isProcessing={isProcessing}
      onStreamComplete={() => {
        void revalidator.revalidate();
      }}
    />
  );
}
