export type ModelTier = "fast" | "standard" | "powerful";

export interface ModelDefinition {
  id: string;
  name: string;
  provider: string;
  tier: ModelTier;
  contextWindow: number;
  costPerInputToken?: number;
  costPerOutputToken?: number;
}

export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMChatParams {
  model: ModelDefinition;
  messages: LLMMessage[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: LLMToolDefinition[];
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export type LLMChunkType = "text" | "tool_call_start" | "tool_call_delta" | "done" | "error";

export interface LLMChunk {
  type: LLMChunkType;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}
