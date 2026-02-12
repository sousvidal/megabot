import { eq, desc } from "drizzle-orm";
import type { AppDatabase } from "~/lib/db";
import { conversations, messages } from "~/lib/db/schema";
import type { Tool, ToolPlugin } from "~/lib/types";
import type { Logger } from "~/lib/logger";

// ---------------------------------------------------------------------------
// list_conversations
// ---------------------------------------------------------------------------

function buildListConversationsTool(db: AppDatabase): Tool {
  return {
    name: "list_conversations",
    description:
      "List recent conversations with their ID, title, and last updated timestamp. " +
      "Returns newest first. Use this to find a conversation before reading its messages.",
    keywords: [
      "conversation",
      "conversations",
      "chat",
      "history",
      "list",
      "recent",
    ],
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description:
            "Maximum number of conversations to return. Defaults to 20.",
        },
      },
      required: [],
    },
    permissions: "read",

    execute(params) {
      const { limit = 20 } = (params ?? {}) as { limit?: number };
      const clamped = Math.min(Math.max(1, limit), 100);

      const rows = db
        .select({
          id: conversations.id,
          title: conversations.title,
          agentId: conversations.agentId,
          updatedAt: conversations.updatedAt,
        })
        .from(conversations)
        .orderBy(desc(conversations.updatedAt))
        .limit(clamped)
        .all();

      if (rows.length === 0) {
        return { success: true, data: "No conversations found." };
      }

      const result = rows.map((r) => ({
        id: r.id,
        title: r.title ?? "(untitled)",
        agentId: r.agentId ?? undefined,
        updatedAt: r.updatedAt.toISOString(),
      }));

      return { success: true, data: result };
    },
  };
}

// ---------------------------------------------------------------------------
// get_conversation_messages
// ---------------------------------------------------------------------------

function executeGetMessages(
  db: AppDatabase,
  params: unknown
) {
  const {
    conversationId,
    limit = 50,
    offset = 0,
  } = params as { conversationId: string; limit?: number; offset?: number };

  const convo = db
    .select({ id: conversations.id, title: conversations.title })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .get();

  if (!convo) {
    return {
      success: false,
      error: `Conversation "${conversationId}" not found. Use list_conversations to see available conversations.`,
    };
  }

  const clampedLimit = Math.min(Math.max(1, limit), 200);
  const clampedOffset = Math.max(0, offset);

  const rows = db
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      model: messages.model,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .limit(clampedLimit)
    .offset(clampedOffset)
    .all();

  if (rows.length === 0) {
    return {
      success: true,
      data: offset > 0
        ? "No more messages at this offset."
        : `Conversation "${convo.title ?? conversationId}" has no messages.`,
    };
  }

  const result = rows.map((r) => ({
    id: r.id,
    role: r.role,
    content:
      r.content.length > 2000
        ? `${r.content.slice(0, 2000)}... (truncated)`
        : r.content,
    model: r.model ?? undefined,
    createdAt: r.createdAt.toISOString(),
  }));

  return {
    success: true,
    data: {
      conversationId,
      title: convo.title ?? "(untitled)",
      messageCount: result.length,
      offset: clampedOffset,
      messages: result,
    },
  };
}

function buildGetConversationMessagesTool(db: AppDatabase): Tool {
  return {
    name: "get_conversation_messages",
    description:
      "Retrieve messages from a specific conversation. Returns role, content, " +
      "and timestamp for each message (newest last). Use list_conversations first " +
      "to find the conversation ID.",
    keywords: ["conversation", "messages", "chat", "history", "read", "context"],
    parameters: {
      type: "object",
      properties: {
        conversationId: {
          type: "string",
          description: "The conversation ID to retrieve messages from.",
        },
        limit: {
          type: "number",
          description: "Maximum number of messages to return. Defaults to 50.",
        },
        offset: {
          type: "number",
          description: "Number of messages to skip (for pagination). Defaults to 0.",
        },
      },
      required: ["conversationId"],
    },
    permissions: "read",
    execute: (params) => executeGetMessages(db, params),
  };
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export function createConversationsPlugin(
  db: AppDatabase,
  logger: Logger
): ToolPlugin {
  const log = logger.child({ plugin: "conversations" });

  return {
    id: "conversations",
    name: "Conversations",
    type: "tool",
    description: "List conversations and read message history",
    tools: [
      buildListConversationsTool(db),
      buildGetConversationMessagesTool(db),
    ],
    afterToolCall: (toolName, _params, _context, result) => {
      if (!result.success) {
        log.warn(
          { tool: toolName, error: result.error },
          "Conversations tool failed"
        );
      }
    },
  };
}
