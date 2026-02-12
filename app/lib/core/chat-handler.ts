import { nanoid } from "nanoid";
import { eq, asc } from "drizzle-orm";
import type { AppDatabase } from "~/lib/db";
import { conversations, messages } from "~/lib/db/schema";
import type { ModelRouter } from "./model-router";
import type { ToolRegistry } from "./tool-registry";
import type { EventBus } from "./event-bus";
import { AgentRunner, BASE_TOOL_NAMES } from "./agent-runner";
import { getSystemPrompt } from "./system-prompt";
import { truncateHistory } from "./chat-handler-utils";
import { logger } from "~/lib/logger";
import type {
  LLMChunk,
  LLMMessage,
  ModelTier,
  ContentBlock,
} from "~/lib/types";

export interface ChatRequest {
  conversationId?: string;
  message: string;
  modelId?: string;
  tier?: ModelTier;
}

export interface ChatResponse {
  conversationId: string;
  stream: AsyncGenerator<LLMChunk>;
}

export class ChatHandler {
  private agentRunner: AgentRunner;

  constructor(
    private db: AppDatabase,
    private modelRouter: ModelRouter,
    private eventBus: EventBus,
    private toolRegistry: ToolRegistry
  ) {
    this.agentRunner = new AgentRunner(db, modelRouter, toolRegistry, eventBus);
  }

  handle(request: ChatRequest): ChatResponse {
    const { message, modelId, tier } = request;
    let { conversationId } = request;

    const { conversationId: convId, userMessageId } =
      this.setupConversation(conversationId, message);
    conversationId = convId;

    const log = logger.child({ module: "chat-handler", conversationId });

    const llmMessages = this.loadHistory(conversationId);
    log.debug({ messageCount: llmMessages.length }, "History loaded");
    const { plugin, model } = this.modelRouter.route({ tier, modelId });

    this.eventBus.emit(
      "llm.request",
      "chat-handler",
      { model: model.id, messageCount: llmMessages.length },
      { conversationId }
    );

    const systemPrompt = getSystemPrompt({
      tools: plugin.supportsTools ? BASE_TOOL_NAMES : [],
    });

    const runner = this.agentRunner;

    async function* streamResponse(): AsyncGenerator<LLMChunk> {
      yield* runner.stream({
        systemPrompt,
        initialMessages: llmMessages,
        tools: plugin.supportsTools ? [...BASE_TOOL_NAMES] : [],
        modelId: model.id,
        conversationId,
        messageId: userMessageId,
      });
    }

    return {
      conversationId,
      stream: streamResponse(),
    };
  }

  private setupConversation(
    conversationId: string | undefined,
    message: string
  ): { conversationId: string; userMessageId: string } {
    const now = new Date();

    if (!conversationId) {
      conversationId = nanoid();
    }

    const existingConvo = this.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .get();

    const log = logger.child({ module: "chat-handler", conversationId });

    if (existingConvo) {
      log.debug("Continuing existing conversation");
      this.db
        .update(conversations)
        .set({ updatedAt: now })
        .where(eq(conversations.id, conversationId))
        .run();
    } else {
      log.info("New conversation created");
      this.db
        .insert(conversations)
        .values({
          id: conversationId,
          title: message.slice(0, 100),
          createdAt: now,
          updatedAt: now,
        })
        .run();

      this.eventBus.emit(
        "conversation.created",
        "chat-handler",
        { title: message.slice(0, 100) },
        { conversationId }
      );
    }

    const userMessageId = nanoid();
    this.db
      .insert(messages)
      .values({
        id: userMessageId,
        conversationId,
        role: "user",
        content: message,
        createdAt: now,
      })
      .run();

    return { conversationId, userMessageId };
  }

  /**
   * Load conversation history from the database.
   * Deserializes structured content blocks from the toolCalls JSON column.
   */
  private loadHistory(conversationId: string): LLMMessage[] {
    const rows = this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt))
      .all();

    const MAX_HISTORY_CHARS = 400_000;
    const llmMessages: LLMMessage[] = [];

    for (const row of rows) {
      if (row.toolCalls) {
        const blocks = JSON.parse(row.toolCalls) as ContentBlock[];

        if (row.role === "tool") {
          llmMessages.push({ role: "user", content: blocks });
        } else {
          llmMessages.push({
            role: row.role as "user" | "assistant",
            content: blocks,
          });
        }
      } else if (row.role !== "tool") {
          llmMessages.push({
            role: row.role as "user" | "assistant",
            content: row.content,
          });
      }
    }

    return truncateHistory(llmMessages, MAX_HISTORY_CHARS);
  }
}
