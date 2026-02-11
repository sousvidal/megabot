import Anthropic from "@anthropic-ai/sdk";
import type { LLMPlugin, LLMChatParams, LLMChunk, ModelDefinition } from "~/lib/types";

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
      const anthropicMessages: Anthropic.MessageParam[] = params.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      try {
        const stream = client.messages.stream({
          model: params.model.id,
          max_tokens: params.maxTokens ?? 4096,
          temperature: params.temperature,
          system: params.systemPrompt,
          messages: anthropicMessages,
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            yield { type: "text", text: event.delta.text };
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
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown Anthropic API error";
        yield { type: "error", error: message };
      }
    },
  };
}
