import type { LLMChatParams, LLMChunk, ModelDefinition } from "./llm";

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
  tools: string[]; // tool names this plugin provides
}

export type Plugin = LLMPlugin | CommPlugin | ToolPlugin;
