import { nanoid } from "nanoid";
import type { AppDatabase } from "~/lib/db";
import { messages } from "~/lib/db/schema";
import type { ModelRouter } from "./model-router";
import type { ToolRegistry } from "./tool-registry";
import type { EventBus } from "./event-bus";
import { safeParseArgs } from "./chat-handler-utils";
import { logger } from "~/lib/logger";
import type {
  LLMChunk,
  LLMMessage,
  LLMToolDefinition,
  LLMPlugin,
  ModelTier,
  ContentBlock,
  ToolUseBlock,
  ToolResultBlock,
} from "~/lib/types";

/** Tools that are always injected without needing discovery via search_tools. */
export const BASE_TOOL_NAMES = [
  "search_tools",
  "get_current_time",
  "run_command",
  "read_file",
  "write_file",
  "list_directory",
  "grep",
  "calculate",
  "create_agent",
  "list_agents",
  "spawn_agent",
  "create_scheduled_task",
  "list_scheduled_tasks",
  "delete_scheduled_task",
];

export interface AgentRunParams {
  systemPrompt: string;
  initialMessages: LLMMessage[];
  /** Tool names to activate. Base tools are always included. */
  tools: string[];
  modelId?: string;
  tier?: ModelTier;
  agentId?: string;
  /** Conversation to persist messages into. If omitted, no persistence. */
  conversationId?: string;
  /** The user message ID that triggered this run (threaded into ToolContext). */
  messageId?: string;
}

export interface AgentRunResult {
  text: string;
  toolCallCount: number;
  usage: { inputTokens: number; outputTokens: number };
}

interface PendingToolCall {
  id: string;
  name: string;
  args: string;
}

export class AgentRunner {
  constructor(
    private db: AppDatabase,
    private modelRouter: ModelRouter,
    private toolRegistry: ToolRegistry,
    private eventBus: EventBus
  ) {}

  /**
   * Stream the agent's tool-call loop, yielding LLM chunks in real time.
   * Used by ChatHandler for SSE streaming to the frontend.
   */
  async *stream(params: AgentRunParams): AsyncGenerator<LLMChunk> {
    const { plugin, model } = this.modelRouter.route({
      tier: params.tier,
      modelId: params.modelId,
    });

    const log = logger.child({
      module: "agent-runner",
      ...(params.conversationId && { conversationId: params.conversationId }),
      ...(params.agentId && { agentId: params.agentId }),
    });

    log.info(
      { model: model.id, messageCount: params.initialMessages.length, toolCount: params.tools.length },
      "Agent stream started"
    );

    const currentMessages: LLMMessage[] = [...params.initialMessages];
    const totalUsage = { inputTokens: 0, outputTokens: 0 };
    const activeToolNames = new Set([...BASE_TOOL_NAMES, ...params.tools]);
    const source = params.agentId
      ? `agent:${params.agentId}`
      : "chat-handler";

    while (true) {
      const toolDefs = this.buildToolDefs(plugin, activeToolNames);
      const { fullText, pendingToolCalls, hasToolCallsPending, hadError } =
        yield* this.callLLM(plugin, model, currentMessages, params, toolDefs, totalUsage, source);

      if (hadError) break;

      if (hasToolCallsPending && pendingToolCalls.length > 0) {
        yield* this.processToolCalls(
          fullText, pendingToolCalls, model.id, currentMessages,
          activeToolNames, source, params,
        );
        continue;
      }

      this.emitFinalResponse(params, fullText, model.id, totalUsage, source);
      yield { type: "done" as const, usage: totalUsage };
      break;
    }
  }

  /**
   * Run the agent to completion without streaming.
   * Used by Inngest functions for background execution.
   */
  async run(params: AgentRunParams): Promise<AgentRunResult> {
    let text = "";
    let toolCallCount = 0;
    const usage = { inputTokens: 0, outputTokens: 0 };

    for await (const chunk of this.stream(params)) {
      if (chunk.type === "text" && chunk.text) text += chunk.text;
      if (chunk.type === "tool_result") toolCallCount++;
      if (chunk.type === "done" && chunk.usage) {
        usage.inputTokens = chunk.usage.inputTokens;
        usage.outputTokens = chunk.usage.outputTokens;
      }
    }

    return { text, toolCallCount, usage };
  }

  // ---------------------------------------------------------------------------
  // Stream sub-steps
  // ---------------------------------------------------------------------------

  private async *callLLM(
    plugin: LLMPlugin,
    model: ReturnType<ModelRouter["route"]>["model"],
    currentMessages: LLMMessage[],
    params: AgentRunParams,
    toolDefs: LLMToolDefinition[] | undefined,
    totalUsage: { inputTokens: number; outputTokens: number },
    source: string,
  ): AsyncGenerator<LLMChunk, {
    fullText: string;
    pendingToolCalls: PendingToolCall[];
    hasToolCallsPending: boolean;
    hadError: boolean;
  }> {
    const eventOpts = { conversationId: params.conversationId, agentId: params.agentId };
    let fullText = "";
    const pendingToolCalls: PendingToolCall[] = [];
    let hasToolCallsPending = false;
    let hadError = false;

    const log = logger.child({
      module: "agent-runner",
      ...(params.conversationId && { conversationId: params.conversationId }),
      ...(params.agentId && { agentId: params.agentId }),
    });

    log.debug({ model: model.id, messageCount: currentMessages.length }, "LLM call started");

    try {
      const llmStream = plugin.chat({
        model,
        messages: currentMessages,
        systemPrompt: params.systemPrompt,
        tools: toolDefs && toolDefs.length > 0 ? toolDefs : undefined,
      });

      for await (const chunk of llmStream) {
        if (chunk.type === "text" && chunk.text) fullText += chunk.text;
        if (chunk.type === "tool_call_end") {
          pendingToolCalls.push({
            id: chunk.toolCallId!, name: chunk.toolName!, args: chunk.toolArgs ?? "{}",
          });
        }
        if (chunk.type === "tool_calls_pending") hasToolCallsPending = true;
        if (chunk.type === "done" && chunk.usage) {
          totalUsage.inputTokens += chunk.usage.inputTokens;
          totalUsage.outputTokens += chunk.usage.outputTokens;
          continue;
        }
        if (chunk.type === "error") {
          this.eventBus.emit("llm.error", source, { error: chunk.error, model: model.id }, { ...eventOpts, level: "error" });
        }
        yield chunk;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      log.error({ error: errorMsg, model: model.id }, "LLM call failed");
      this.eventBus.emit("llm.error", source, { error: errorMsg, model: model.id }, { ...eventOpts, level: "error" });
      yield { type: "error" as const, error: errorMsg };
      hadError = true;
    }

    return { fullText, pendingToolCalls, hasToolCallsPending, hadError };
  }

  private async *processToolCalls(
    fullText: string,
    pendingToolCalls: PendingToolCall[],
    modelId: string,
    currentMessages: LLMMessage[],
    activeToolNames: Set<string>,
    source: string,
    params: AgentRunParams,
  ): AsyncGenerator<LLMChunk> {
    const assistantBlocks = this.buildAssistantBlocks(fullText, pendingToolCalls);

    if (params.conversationId) {
      this.persistMessage(params.conversationId, {
        role: "assistant",
        content: fullText || "[tool calls]",
        toolCalls: JSON.stringify(assistantBlocks),
        model: modelId,
      });
    }

    const toolResultBlocks: ToolResultBlock[] = [];
    for (const tc of pendingToolCalls) {
      const resultBlock = yield* this.executeTool(tc, source, activeToolNames, params);
      toolResultBlocks.push(resultBlock);
    }

    if (params.conversationId) {
      this.persistMessage(params.conversationId, {
        role: "tool",
        content: toolResultBlocks
          .map((r) => `${r.toolUseId}: ${r.isError ? "ERROR " : ""}${r.content.slice(0, 200)}`)
          .join("\n"),
        toolCalls: JSON.stringify(toolResultBlocks),
      });
    }

    currentMessages.push({ role: "assistant", content: assistantBlocks });
    currentMessages.push({ role: "user", content: toolResultBlocks });
  }

  private emitFinalResponse(
    params: AgentRunParams,
    fullText: string,
    modelId: string,
    totalUsage: { inputTokens: number; outputTokens: number },
    source: string,
  ): void {
    const log = logger.child({
      module: "agent-runner",
      ...(params.conversationId && { conversationId: params.conversationId }),
      ...(params.agentId && { agentId: params.agentId }),
    });
    log.info(
      { model: modelId, usage: totalUsage, contentLength: fullText.length },
      "Agent stream completed"
    );
    if (params.conversationId) {
      this.persistMessage(params.conversationId, {
        role: "assistant",
        content: fullText || "[Error: no response generated]",
        model: modelId,
        tokenCount: totalUsage.inputTokens + totalUsage.outputTokens || undefined,
      });
    }

    if (fullText) {
      this.eventBus.emit("llm.response", source, {
        model: modelId, tokens: totalUsage, contentLength: fullText.length,
      }, { conversationId: params.conversationId, agentId: params.agentId });
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildToolDefs(
    plugin: LLMPlugin,
    activeToolNames: Set<string>
  ): LLMToolDefinition[] | undefined {
    if (!plugin.supportsTools) return undefined;
    return this.toolRegistry
      .getAll()
      .filter((t) => activeToolNames.has(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
  }

  private buildAssistantBlocks(
    fullText: string,
    pendingToolCalls: PendingToolCall[]
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

  private async *executeTool(
    tc: PendingToolCall,
    source: string,
    activeToolNames: Set<string>,
    params: AgentRunParams
  ): AsyncGenerator<LLMChunk, ToolResultBlock> {
    const eventOpts = {
      conversationId: params.conversationId,
      agentId: params.agentId,
    };

    const log = logger.child({
      module: "agent-runner",
      tool: tc.name,
      ...(params.conversationId && { conversationId: params.conversationId }),
      ...(params.agentId && { agentId: params.agentId }),
    });

    yield {
      type: "tool_executing" as const,
      toolCallId: tc.id,
      toolName: tc.name,
    };

    this.eventBus.emit("tool.called", source, { tool: tc.name, args: tc.args }, eventOpts);

    log.debug("Tool executing");
    const startTime = Date.now();
    const parsedArgs = safeParseArgs(tc.args);
    const result = await this.toolRegistry.execute(tc.name, parsedArgs, {
      conversationId: params.conversationId,
      agentId: params.agentId,
      messageId: params.messageId,
    });
    const durationMs = Date.now() - startTime;

    const resultContent = result.success
      ? typeof result.data === "string"
        ? result.data
        : JSON.stringify(result.data)
      : `Error: ${result.error}`;
    const isError = !result.success;

    yield {
      type: "tool_result" as const,
      toolCallId: tc.id,
      toolName: tc.name,
      toolResult: { content: resultContent, isError },
    };

    if (isError) {
      log.error({ durationMs, error: resultContent }, "Tool failed");
    } else {
      log.debug({ durationMs }, "Tool completed");
    }

    this.eventBus.emit(
      result.success ? "tool.result" : "tool.error",
      source,
      { tool: tc.name, result: resultContent, isError },
      { ...eventOpts, level: isError ? "error" : "info" }
    );

    // Expand active tools when search_tools discovers new ones
    if (tc.name === "search_tools" && result.success) {
      const query = parsedArgs.query as string | undefined;
      if (query) {
        for (const tool of this.toolRegistry.search(query)) {
          activeToolNames.add(tool.name);
        }
      }
    }

    return {
      type: "tool_result" as const,
      toolUseId: tc.id,
      content: resultContent,
      isError,
    };
  }

  private persistMessage(
    conversationId: string,
    data: {
      role: "assistant" | "tool";
      content: string;
      toolCalls?: string;
      model?: string;
      tokenCount?: number;
    }
  ): void {
    this.db
      .insert(messages)
      .values({
        id: nanoid(),
        conversationId,
        role: data.role,
        content: data.content,
        toolCalls: data.toolCalls,
        model: data.model,
        tokenCount: data.tokenCount,
        createdAt: new Date(),
      })
      .run();
  }
}
