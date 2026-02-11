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

// --- Content Blocks ---

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

// --- Messages ---

export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string | ContentBlock[];
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

// --- Stream Chunks ---

export type LLMChunkType =
  | "text"
  | "tool_call_start"
  | "tool_call_delta"
  | "tool_call_end"
  | "tool_calls_pending"
  | "tool_executing"
  | "tool_result"
  | "done"
  | "error";

export interface LLMChunk {
  type: LLMChunkType;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  toolArgs?: string;
  toolResult?: {
    content: string;
    isError: boolean;
  };
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// --- Helpers ---

/** Extract plain text from message content (string or content blocks). */
export function getMessageText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}
