export type PermissionLevel = "none" | "read" | "write" | "admin";

export interface ToolContext {
  conversationId?: string;
  agentId?: string;
  userId?: string;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  execute: (params: unknown, context: ToolContext) => Promise<ToolResult>;
  permissions: PermissionLevel;
  pluginId?: string;
}
