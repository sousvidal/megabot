import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// --- Conversations ---
export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title"),
  pluginId: text("plugin_id"),
  channelId: text("channel_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// --- Messages ---
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant", "system", "tool"] }).notNull(),
  content: text("content").notNull(),
  toolCalls: text("tool_calls"), // JSON string
  tokenCount: integer("token_count"),
  model: text("model"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// --- Plugins ---
export const plugins = sqliteTable("plugins", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", { enum: ["llm", "comm", "tool"] }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  config: text("config"), // JSON string
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// --- Tools ---
export const tools = sqliteTable("tools", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  parametersSchema: text("parameters_schema"), // JSON string
  pluginId: text("plugin_id").references(() => plugins.id),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
});

// --- Agents ---
export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  tools: text("tools"), // JSON array of tool names
  model: text("model"),
  tier: text("tier", { enum: ["fast", "standard", "powerful"] }),
  schedule: text("schedule"), // cron expression
  createdBy: text("created_by", { enum: ["system", "bot", "user"] }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// --- Tasks ---
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  status: text("status", {
    enum: ["pending", "running", "completed", "failed", "cancelled"],
  }).notNull(),
  input: text("input"), // JSON string
  result: text("result"), // JSON string
  agentId: text("agent_id").references(() => agents.id),
  conversationId: text("conversation_id").references(() => conversations.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

// --- Events ---
export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  source: text("source").notNull(),
  agentId: text("agent_id"),
  conversationId: text("conversation_id"),
  data: text("data"), // JSON string
  level: text("level", { enum: ["debug", "info", "warn", "error"] }).notNull(),
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
});

// --- Config ---
export const config = sqliteTable("config", {
  key: text("key").primaryKey(),
  value: text("value"), // JSON string
});
