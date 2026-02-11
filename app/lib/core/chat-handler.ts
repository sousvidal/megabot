import { nanoid } from "nanoid";
import { eq, asc } from "drizzle-orm";
import type { AppDatabase } from "~/lib/db";
import { conversations, messages } from "~/lib/db/schema";
import type { ModelRouter } from "./model-router";
import type { EventBus } from "./event-bus";
import { getSystemPrompt } from "./system-prompt";
import type { LLMChunk, LLMMessage, ModelTier } from "~/lib/types";

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
  constructor(
    private db: AppDatabase,
    private modelRouter: ModelRouter,
    private eventBus: EventBus
  ) {}

  async handle(request: ChatRequest): Promise<ChatResponse> {
    const { message, modelId, tier } = request;
    let { conversationId } = request;
    const now = new Date();

    // Create conversation if needed
    if (!conversationId) {
      conversationId = nanoid();
      this.db.insert(conversations).values({
        id: conversationId,
        title: message.slice(0, 100),
        createdAt: now,
        updatedAt: now,
      }).run();
    } else {
      // Update the conversation timestamp
      this.db
        .update(conversations)
        .set({ updatedAt: now })
        .where(eq(conversations.id, conversationId))
        .run();
    }

    // Persist the user message
    this.db.insert(messages).values({
      id: nanoid(),
      conversationId,
      role: "user",
      content: message,
      createdAt: now,
    }).run();

    // Load conversation history
    const history = this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt))
      .all();

    // Truncate history to fit within context window.
    // Rough estimate: ~4 chars per token. Reserve 100k tokens (~400k chars) for
    // history, leaving room for the system prompt and the model's response.
    const MAX_HISTORY_CHARS = 400_000;
    const llmMessages = truncateHistory(
      history.map((m) => ({
        role: m.role as LLMMessage["role"],
        content: m.content,
      })),
      MAX_HISTORY_CHARS
    );

    // Route to the right model
    const { plugin, model } = this.modelRouter.route({ tier, modelId });

    this.eventBus.emit("llm.request", "chat-handler", {
      model: model.id,
      messageCount: llmMessages.length,
    }, { conversationId });

    const systemPrompt = getSystemPrompt();

    // Create the streaming generator
    const self = this;
    const convId = conversationId;

    async function* streamResponse(): AsyncGenerator<LLMChunk> {
      let fullText = "";
      let tokenUsage: { inputTokens: number; outputTokens: number } | undefined;

      try {
        const llmStream = plugin.chat({
          model,
          messages: llmMessages,
          systemPrompt,
        });

        for await (const chunk of llmStream) {
          if (chunk.type === "text" && chunk.text) {
            fullText += chunk.text;
          }
          if (chunk.type === "done" && chunk.usage) {
            tokenUsage = chunk.usage;
          }
          if (chunk.type === "error") {
            self.eventBus.emit("llm.error", "chat-handler", {
              error: chunk.error,
              model: model.id,
            }, { conversationId: convId, level: "error" });
          }
          yield chunk;
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        self.eventBus.emit("llm.error", "chat-handler", {
          error: errorMsg,
          model: model.id,
        }, { conversationId: convId, level: "error" });
        yield { type: "error" as const, error: errorMsg };
      }

      // Always persist an assistant message to maintain user/assistant alternation.
      // If the LLM produced no text (e.g. errored immediately), store an error placeholder.
      // This prevents consecutive user messages which would crash the Anthropic API.
      const contentToSave = fullText || "[Error: no response generated]";
      self.db.insert(messages).values({
        id: nanoid(),
        conversationId: convId,
        role: "assistant",
        content: contentToSave,
        model: model.id,
        tokenCount: tokenUsage
          ? tokenUsage.inputTokens + tokenUsage.outputTokens
          : undefined,
        createdAt: new Date(),
      }).run();

      if (fullText) {
        self.eventBus.emit("llm.response", "chat-handler", {
          model: model.id,
          tokens: tokenUsage,
          contentLength: fullText.length,
        }, { conversationId: convId });
      }
    }

    return {
      conversationId,
      stream: streamResponse(),
    };
  }
}

/**
 * Truncate conversation history to fit within a character budget.
 * Keeps the most recent messages, always preserving at least the last user message.
 * Ensures messages still alternate user/assistant (doesn't cut mid-pair).
 */
function truncateHistory(
  messages: LLMMessage[],
  maxChars: number
): LLMMessage[] {
  let totalChars = 0;
  for (const m of messages) {
    totalChars += m.content.length;
  }

  if (totalChars <= maxChars) {
    return messages;
  }

  // Work backwards, keeping messages until we hit the budget
  const kept: LLMMessage[] = [];
  let chars = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (chars + msg.content.length > maxChars && kept.length > 0) {
      break;
    }
    chars += msg.content.length;
    kept.unshift(msg);
  }

  // Ensure the first message is a user message (Anthropic requires this)
  while (kept.length > 0 && kept[0]!.role !== "user") {
    kept.shift();
  }

  return kept;
}
