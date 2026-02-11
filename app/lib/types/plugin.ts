import type { LLMChatParams, LLMChunk, ModelDefinition } from "./llm";
import type { Tool, ToolContext, ToolResult } from "./tool";

export type PluginType = "llm" | "comm" | "tool";

export interface PluginBase {
  id: string;
  name: string;
  type: PluginType;
  description?: string;
  initialize?: () => Promise<void>;
  shutdown?: () => Promise<void>;
}

export interface LLMPlugin extends PluginBase {
  type: "llm";
  models: ModelDefinition[];
  supportsTools: boolean;
  supportsVision: boolean;
  chat: (params: LLMChatParams) => AsyncGenerator<LLMChunk>;
}

export interface CommPlugin extends PluginBase {
  type: "comm";
  sendMessage: (channelId: string, content: string) => Promise<void>;
}

export interface ToolPlugin extends PluginBase {
  type: "tool";
  tools: Tool[];
  beforeToolCall?: (
    toolName: string,
    params: unknown,
    context: ToolContext
  ) => Promise<void> | void;
  afterToolCall?: (
    toolName: string,
    params: unknown,
    context: ToolContext,
    result: ToolResult
  ) => Promise<void> | void;
}

export type Plugin = LLMPlugin | CommPlugin | ToolPlugin;
