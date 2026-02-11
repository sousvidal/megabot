export type BotEventType =
  | "message.received"
  | "message.sent"
  | "llm.request"
  | "llm.response"
  | "llm.error"
  | "tool.called"
  | "tool.result"
  | "tool.error"
  | "agent.spawned"
  | "agent.completed"
  | "agent.error"
  | "plan.created"
  | "plan.approved"
  | "plan.rejected"
  | "task.dispatched"
  | "task.completed"
  | "task.failed"
  | "task.retrying"
  | "chat.completed"
  | "cron.triggered"
  | "cron.created"
  | "safety.check"
  | "system.info";

export type EventLevel = "debug" | "info" | "warn" | "error";

export interface BotEvent {
  id: string;
  timestamp: Date;
  type: BotEventType;
  source: string;
  agentId?: string;
  conversationId?: string;
  data: Record<string, unknown>;
  level: EventLevel;
}
