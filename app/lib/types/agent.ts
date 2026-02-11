import type { ModelTier } from "./llm";

export interface AgentDefinition {
  id: string;
  name: string;
  prompt: string;
  tools: string[];
  model?: string;
  tier?: ModelTier;
  schedule?: string; // cron expression
  createdBy?: "system" | "bot" | "user";
}
