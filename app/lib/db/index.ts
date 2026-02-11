import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";

export type AppDatabase = ReturnType<typeof createDatabase>;

export function createDatabase(dbPath: string) {
  // Ensure the directory exists
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  // Create tables if they don't exist (push schema)
  pushSchema(sqlite);

  return db;
}

/**
 * Push schema to the database by creating tables if they don't exist.
 * This is a simple approach for dev; in production, use drizzle-kit migrations.
 */
function pushSchema(sqlite: Database.Database) {
  createCoreTables(sqlite);
  createIndexes(sqlite);
  migrateExistingColumns(sqlite);
}

function createCoreTables(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      plugin_id TEXT,
      channel_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
      content TEXT NOT NULL,
      tool_calls TEXT,
      token_count INTEGER,
      model TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('llm', 'comm', 'tool')),
      enabled INTEGER NOT NULL DEFAULT 1,
      config TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      parameters_schema TEXT,
      plugin_id TEXT REFERENCES plugins(id),
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      tools TEXT,
      model TEXT,
      tier TEXT CHECK(tier IN ('fast', 'standard', 'powerful')),
      schedule TEXT,
      created_by TEXT CHECK(created_by IN ('system', 'bot', 'user')),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
      input TEXT,
      result TEXT,
      agent_id TEXT REFERENCES agents(id),
      conversation_id TEXT REFERENCES conversations(id),
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      agent_id TEXT,
      conversation_id TEXT,
      data TEXT,
      level TEXT NOT NULL CHECK(level IN ('debug', 'info', 'warn', 'error')),
      timestamp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      schedule TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('recurring', 'one_shot')),
      agent_id TEXT,
      input TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'completed')),
      last_run_at INTEGER,
      next_run_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

function createIndexes(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_conversation ON events(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_status ON scheduled_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(next_run_at);
  `);
}

function migrateExistingColumns(sqlite: Database.Database) {
  // Safe column additions for existing databases
  const safeAlter = (sql: string) => {
    try {
      sqlite.exec(sql);
    } catch {
      // Column already exists — ignore
    }
  };

  safeAlter("ALTER TABLE conversations ADD COLUMN agent_id TEXT");
  safeAlter("ALTER TABLE tasks ADD COLUMN origin_conversation_id TEXT");
  safeAlter("ALTER TABLE tasks ADD COLUMN origin_message_id TEXT");
}

export { schema };
