import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMPlugin,
  LLMChatParams,
  LLMChunk,
  LLMToolDefinition,
  ModelDefinition,
  LLMMessage,
  ContentBlock,
} from "~/lib/types";

const ANTHROPIC_MODELS: ModelDefinition[] = [
  {
    id: "claude-sonnet-4-5-20250929",
    name: "Claude Sonnet 4.5",
    provider: "anthropic",
    tier: "standard",
    contextWindow: 200000,
    costPerInputToken: 0.000003,
    costPerOutputToken: 0.000015,
  },
  {
    id: "claude-haiku-4-20250414",
    name: "Claude Haiku 4",
    provider: "anthropic",
    tier: "fast",
    contextWindow: 200000,
    costPerInputToken: 0.0000008,
    costPerOutputToken: 0.000004,
  },
  {
    id: "claude-opus-4-20250514",
    name: "Claude Opus 4",
    provider: "anthropic",
    tier: "powerful",
    contextWindow: 200000,
    costPerInputToken: 0.000015,
    costPerOutputToken: 0.000075,
  },
];

/**
 * Map our LLMToolDefinition[] to the Anthropic API tool format.
 */
function mapTools(tools: LLMToolDefinition[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool.InputSchema,
  }));
}

/**
 * Map our ContentBlock[] to Anthropic content block format.
 */
function mapContentBlocks(
  blocks: ContentBlock[]
): Anthropic.ContentBlockParam[] {
  return blocks.map((block) => {
    switch (block.type) {
      case "text":
        return { type: "text" as const, text: block.text };
      case "tool_use":
        return {
          type: "tool_use" as const,
          id: block.id,
          name: block.name,
          input: block.input,
        };
      case "tool_result":
        return {
          type: "tool_result" as const,
          tool_use_id: block.toolUseId,
          content: block.content,
          is_error: block.isError ?? false,
        };
    }
  });
}

/**
 * Map our LLMMessage[] to Anthropic MessageParam[].
 * Handles both string content and structured content blocks.
 */
function mapMessages(messages: LLMMessage[]): Anthropic.MessageParam[] {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content:
        typeof m.content === "string"
          ? m.content
          : mapContentBlocks(m.content),
    }));
}

type ToolInputBuffer = { id: string; name: string; json: string };

async function* processAnthropicStream(
  stream: Anthropic.MessageStream,
  toolInputBuffers: Map<number, ToolInputBuffer>
): AsyncGenerator<LLMChunk> {
  for await (const event of stream) {
    switch (event.type) {
      case "content_block_start":
        if (event.content_block.type === "tool_use") {
          const block = event.content_block;
          toolInputBuffers.set(event.index, {
            id: block.id,
            name: block.name,
            json: "",
          });
          yield {
            type: "tool_call_start",
            toolCallId: block.id,
            toolName: block.name,
          };
        }
        break;

      case "content_block_delta":
        if (event.delta.type === "text_delta") {
          yield { type: "text", text: event.delta.text };
        } else if (event.delta.type === "input_json_delta") {
          const buffer = toolInputBuffers.get(event.index);
          if (buffer) {
            buffer.json += event.delta.partial_json;
            yield {
              type: "tool_call_delta",
              toolCallId: buffer.id,
              text: event.delta.partial_json,
            };
          }
        }
        break;

      case "content_block_stop": {
        const buffer = toolInputBuffers.get(event.index);
        if (buffer) {
          yield {
            type: "tool_call_end",
            toolCallId: buffer.id,
            toolName: buffer.name,
            toolArgs: buffer.json,
          };
          toolInputBuffers.delete(event.index);
        }
        break;
      }

      case "message_delta":
        if (event.delta.stop_reason === "tool_use") {
          yield { type: "tool_calls_pending" };
        }
        break;
    }
  }

  const finalMessage = await stream.finalMessage();
  yield {
    type: "done",
    usage: {
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    },
  };
}

export function createAnthropicPlugin(apiKey: string): LLMPlugin {
  const client = new Anthropic({ apiKey });

  return {
    id: "anthropic",
    name: "Anthropic",
    type: "llm",
    models: ANTHROPIC_MODELS,
    supportsTools: true,
    supportsVision: true,

    async *chat(params: LLMChatParams): AsyncGenerator<LLMChunk> {
      const anthropicMessages = mapMessages(params.messages);

      const requestParams: Anthropic.MessageCreateParams = {
        model: params.model.id,
        max_tokens: params.maxTokens ?? 4096,
        temperature: params.temperature,
        system: params.systemPrompt,
        messages: anthropicMessages,
      };

      if (params.tools && params.tools.length > 0) {
        requestParams.tools = mapTools(params.tools);
      }

      const toolInputBuffers = new Map<number, ToolInputBuffer>();

      try {
        const stream = client.messages.stream(requestParams);
        yield* processAnthropicStream(stream, toolInputBuffers);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown Anthropic API error";
        yield { type: "error", error: message };
      }
    },
  };
}
