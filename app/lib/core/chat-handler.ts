import { nanoid } from "nanoid";
import { eq, asc } from "drizzle-orm";
import type { AppDatabase } from "~/lib/db";
import { conversations, messages } from "~/lib/db/schema";
import type { ModelRouter } from "./model-router";
import type { ToolRegistry } from "./tool-registry";
import type { EventBus } from "./event-bus";
import { getSystemPrompt } from "./system-prompt";
import { safeParseArgs, truncateHistory } from "./chat-handler-utils";
import type {
  LLMChunk,
  LLMMessage,
  LLMToolDefinition,
  ModelTier,
  ContentBlock,
  ToolUseBlock,
  ToolResultBlock,
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

interface PendingToolCall {
  id: string;
  name: string;
  args: string; // raw JSON
}

/** Tools that are always injected without needing discovery via search_tools. */
const BASE_TOOL_NAMES = new Set(["search_tools", "get_current_time"]);

export class ChatHandler {
  constructor(
    private db: AppDatabase,
    private modelRouter: ModelRouter,
    private eventBus: EventBus,
    private toolRegistry: ToolRegistry
  ) {}

  async handle(request: ChatRequest): Promise<ChatResponse> {
    const { message, modelId, tier } = request;
    let { conversationId } = request;
    
    conversationId = this.setupConversation(conversationId, message);
    const llmMessages = this.loadHistory(conversationId);
    const { plugin, model } = this.modelRouter.route({ tier, modelId });

    this.eventBus.emit(
      "llm.request",
      "chat-handler",
      { model: model.id, messageCount: llmMessages.length },
      { conversationId }
    );

    const systemPrompt = getSystemPrompt({
      tools: plugin.supportsTools ? ["search_tools", "get_current_time"] : [],
    });

    return {
      conversationId,
      stream: this.createStreamResponse(conversationId, llmMessages, plugin, model, systemPrompt),
    };
  }

  private setupConversation(conversationId: string | undefined, message: string): string {
    const now = new Date();
    
    if (!conversationId) {
      conversationId = nanoid();
    }

    const existingConvo = this.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .get();

    if (existingConvo) {
      this.db
        .update(conversations)
        .set({ updatedAt: now })
        .where(eq(conversations.id, conversationId))
        .run();
    } else {
      this.db
        .insert(conversations)
        .values({
          id: conversationId,
          title: message.slice(0, 100),
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    this.db
      .insert(messages)
      .values({
        id: nanoid(),
        conversationId,
        role: "user",
        content: message,
        createdAt: now,
      })
      .run();

    return conversationId;
  }

  private async *createStreamResponse(
    conversationId: string,
    llmMessages: LLMMessage[],
    plugin: ReturnType<ModelRouter["route"]>["plugin"],
    model: ReturnType<ModelRouter["route"]>["model"],
    systemPrompt: string
  ): AsyncGenerator<LLMChunk> {
    const currentMessages: LLMMessage[] = [...llmMessages];
    let totalUsage = { inputTokens: 0, outputTokens: 0 };
    const activeToolNames = new Set(BASE_TOOL_NAMES);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const toolDefs = this.getActiveToolDefinitions(plugin, activeToolNames);
      const { fullText, pendingToolCalls, hasToolCallsPending } = 
        yield* this.callLLM(plugin, model, currentMessages, systemPrompt, toolDefs, conversationId, totalUsage);

      if (hasToolCallsPending && pendingToolCalls.length > 0) {
        const { assistantBlocks, toolResultBlocks } = await this.executeTools(
          pendingToolCalls,
          fullText,
          conversationId,
          model.id,
          activeToolNames
        );

        currentMessages.push({ role: "assistant", content: assistantBlocks });
        currentMessages.push({ role: "user", content: toolResultBlocks });
        continue;
      }

      this.persistFinalResponse(conversationId, fullText, model.id, totalUsage);
      yield { type: "done" as const, usage: totalUsage };
      break;
    }
  }

  private getActiveToolDefinitions(
    plugin: ReturnType<ModelRouter["route"]>["plugin"],
    activeToolNames: Set<string>
  ): LLMToolDefinition[] | undefined {
    return plugin.supportsTools
      ? this.toolRegistry
          .getAll()
          .filter((t) => activeToolNames.has(t.name))
          .map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          }))
      : undefined;
  }

  private async *callLLM(
    plugin: ReturnType<ModelRouter["route"]>["plugin"],
    model: ReturnType<ModelRouter["route"]>["model"],
    currentMessages: LLMMessage[],
    systemPrompt: string,
    toolDefs: LLMToolDefinition[] | undefined,
    conversationId: string,
    totalUsage: { inputTokens: number; outputTokens: number }
  ) {
    let fullText = "";
    const pendingToolCalls: PendingToolCall[] = [];
    let hasToolCallsPending = false;

    try {
      const llmStream = plugin.chat({
        model,
        messages: currentMessages,
        systemPrompt,
        tools: toolDefs && toolDefs.length > 0 ? toolDefs : undefined,
      });

      for await (const chunk of llmStream) {
        if (chunk.type === "text" && chunk.text) {
          fullText += chunk.text;
        }
        if (chunk.type === "tool_call_end") {
          pendingToolCalls.push({
            id: chunk.toolCallId!,
            name: chunk.toolName!,
            args: chunk.toolArgs ?? "{}",
          });
        }
        if (chunk.type === "tool_calls_pending") {
          hasToolCallsPending = true;
        }
        if (chunk.type === "done" && chunk.usage) {
          totalUsage.inputTokens += chunk.usage.inputTokens;
          totalUsage.outputTokens += chunk.usage.outputTokens;
          continue;
        }
        if (chunk.type === "error") {
          this.eventBus.emit(
            "llm.error",
            "chat-handler",
            { error: chunk.error, model: model.id },
            { conversationId, level: "error" }
          );
        }
        yield chunk;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      this.eventBus.emit(
        "llm.error",
        "chat-handler",
        { error: errorMsg, model: model.id },
        { conversationId, level: "error" }
      );
      yield { type: "error" as const, error: errorMsg };
    }

    return { fullText, pendingToolCalls, hasToolCallsPending };
  }

  private async *executeTools(
    pendingToolCalls: PendingToolCall[],
    fullText: string,
    conversationId: string,
    modelId: string,
    activeToolNames: Set<string>
  ) {
    const assistantBlocks = this.buildAssistantBlocks(pendingToolCalls, fullText);
    this.persistAssistantMessage(conversationId, modelId, fullText, assistantBlocks);

    const toolResultBlocks: ToolResultBlock[] = [];
    for (const tc of pendingToolCalls) {
      yield* this.executeSingleTool(
        tc,
        conversationId,
        toolResultBlocks,
        activeToolNames
      );
    }

    this.persistToolResults(conversationId, toolResultBlocks);
    return { assistantBlocks, toolResultBlocks };
  }

  private buildAssistantBlocks(
    pendingToolCalls: PendingToolCall[],
    fullText: string
  ): ContentBlock[] {
    const blocks: ContentBlock[] = [];
    if (fullText) {
      blocks.push({ type: "text", text: fullText });
    }
    for (const tc of pendingToolCalls) {
      blocks.push({
        type: "tool_use",
        id: tc.id,
        name: tc.name,
        input: safeParseArgs(tc.args),
      } satisfies ToolUseBlock);
    }
    return blocks;
  }

  private persistAssistantMessage(
    conversationId: string,
    modelId: string,
    fullText: string,
    assistantBlocks: ContentBlock[]
  ) {
    this.db
      .insert(messages)
      .values({
        id: nanoid(),
        conversationId,
        role: "assistant",
        content: fullText || "[tool calls]",
        toolCalls: JSON.stringify(assistantBlocks),
        model: modelId,
        createdAt: new Date(),
      })
      .run();
  }

  private async *executeSingleTool(
    tc: PendingToolCall,
    conversationId: string,
    toolResultBlocks: ToolResultBlock[],
    activeToolNames: Set<string>
  ) {
    yield {
      type: "tool_executing" as const,
      toolCallId: tc.id,
      toolName: tc.name,
    };

    this.eventBus.emit(
      "tool.called",
      "chat-handler",
      { tool: tc.name, args: tc.args },
      { conversationId }
    );

    const parsedArgs = safeParseArgs(tc.args);
    const result = await this.toolRegistry.execute(tc.name, parsedArgs, {
      conversationId,
    });

    const resultContent = result.success
      ? typeof result.data === "string"
        ? result.data
        : JSON.stringify(result.data)
      : `Error: ${result.error}`;

    const isError = !result.success;

    toolResultBlocks.push({
      type: "tool_result",
      toolUseId: tc.id,
      content: resultContent,
      isError,
    });

    yield {
      type: "tool_result" as const,
      toolCallId: tc.id,
      toolName: tc.name,
      toolResult: { content: resultContent, isError },
    };

    this.eventBus.emit(
      result.success ? "tool.result" : "tool.error",
      "chat-handler",
      { tool: tc.name, result: resultContent, isError },
      { conversationId, level: isError ? "error" : "info" }
    );

    if (tc.name === "search_tools" && result.success) {
      this.expandActiveTools(parsedArgs, activeToolNames);
    }
  }

  private expandActiveTools(
    parsedArgs: Record<string, unknown>,
    activeToolNames: Set<string>
  ) {
    const query = parsedArgs.query as string | undefined;
    if (query) {
      const discovered = this.toolRegistry.search(query);
      for (const tool of discovered) {
        activeToolNames.add(tool.name);
      }
    }
  }

  private persistToolResults(
    conversationId: string,
    toolResultBlocks: ToolResultBlock[]
  ) {
    this.db
      .insert(messages)
      .values({
        id: nanoid(),
        conversationId,
        role: "tool",
        content: toolResultBlocks
          .map(
            (r) =>
              `${r.toolUseId}: ${r.isError ? "ERROR " : ""}${r.content.slice(0, 200)}`
          )
          .join("\n"),
        toolCalls: JSON.stringify(toolResultBlocks),
        createdAt: new Date(),
      })
      .run();
  }

  private persistFinalResponse(
    conversationId: string,
    fullText: string,
    modelId: string,
    totalUsage: { inputTokens: number; outputTokens: number }
  ) {
    const contentToSave = fullText || "[Error: no response generated]";
    this.db
      .insert(messages)
      .values({
        id: nanoid(),
        conversationId,
        role: "assistant",
        content: contentToSave,
        model: modelId,
        tokenCount: totalUsage.inputTokens + totalUsage.outputTokens || undefined,
        createdAt: new Date(),
      })
      .run();

    if (fullText) {
      this.eventBus.emit(
        "llm.response",
        "chat-handler",
        {
          model: modelId,
          tokens: totalUsage,
          contentLength: fullText.length,
        },
        { conversationId }
      );
    }
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
        // Structured content — parse the blocks
        const blocks = JSON.parse(row.toolCalls) as ContentBlock[];

        if (row.role === "tool") {
          // Tool result messages are sent as user role to the LLM
          llmMessages.push({ role: "user", content: blocks });
        } else {
          llmMessages.push({
            role: row.role as "user" | "assistant",
            content: blocks,
          });
        }
      } else if (row.role !== "tool") {
        // Plain text message
        llmMessages.push({
          role: row.role as LLMMessage["role"],
          content: row.content,
        });
      }
    }

    return truncateHistory(llmMessages, MAX_HISTORY_CHARS);
  }
}
