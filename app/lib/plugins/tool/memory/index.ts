import { eq, like } from "drizzle-orm";
import type { Tool, ToolResult, ToolPlugin } from "~/lib/types";
import type { AppDatabase } from "~/lib/db";
import { config } from "~/lib/db/schema";
import type { Logger } from "~/lib/logger";

const MEMORY_PREFIX = "memory:";

function executeMemoryStore(
  db: AppDatabase,
  params: Record<string, unknown>
): ToolResult {
  const { key, value } = params as { key: string; value: string };
  const fullKey = `${MEMORY_PREFIX}${key}`;

  // Upsert: delete then insert (SQLite-friendly)
  db.delete(config).where(eq(config.key, fullKey)).run();
  db.insert(config)
    .values({ key: fullKey, value: JSON.stringify(value) })
    .run();

  return {
    success: true,
    data: `Stored memory: "${key}" = "${value}"`,
  };
}

function executeMemoryRecall(
  db: AppDatabase,
  params: Record<string, unknown>
): ToolResult {
  const { query } = params as { query?: string };

  let rows;
  if (query && query.trim().length > 0) {
    rows = db
      .select()
      .from(config)
      .where(like(config.key, `${MEMORY_PREFIX}%${query}%`))
      .all();
  } else {
    rows = db
      .select()
      .from(config)
      .where(like(config.key, `${MEMORY_PREFIX}%`))
      .all();
  }

  if (rows.length === 0) {
    return {
      success: true,
      data: query
        ? `No memories found matching "${query}".`
        : "No memories stored yet.",
    };
  }

  const formatted = rows.map((r) => {
    const key = r.key.slice(MEMORY_PREFIX.length);
    let value: string;
    try {
      value = JSON.parse(r.value ?? '""') as string;
    } catch {
      value = r.value ?? "";
    }
    return `- **${key}**: ${value}`;
  });

  return {
    success: true,
    data: `Found ${rows.length} memory(ies):\n${formatted.join("\n")}`,
  };
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export function createMemoryPlugin(
  db: AppDatabase,
  logger: Logger
): ToolPlugin {
  const log = logger.child({ plugin: "memory" });

  const store: Tool = {
    name: "memory_store",
    description:
      "Store a piece of information for later recall. Use this to remember facts, user preferences, important details, or anything that should persist across conversations. Keys should be descriptive (e.g. 'user_favorite_color', 'project_deadline').",
    keywords: [
      "remember",
      "note",
      "save",
      "knowledge",
      "fact",
      "persist",
      "preference",
    ],
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description:
            "A descriptive key for the memory (e.g. 'user_name', 'favorite_language').",
        },
        value: {
          type: "string",
          description: "The value to store.",
        },
      },
      required: ["key", "value"],
    },
    permissions: "write",
    execute: (params) =>
      executeMemoryStore(db, params as Record<string, unknown>),
  };

  const recall: Tool = {
    name: "memory_recall",
    description:
      "Search stored memories by keyword. Returns all memories whose key matches the query. Use this to recall previously stored information like user preferences, names, dates, or facts.",
    keywords: [
      "remember",
      "note",
      "lookup",
      "knowledge",
      "fact",
      "preference",
      "retrieve",
    ],
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query to match against memory keys. Leave empty to list all memories.",
        },
      },
      required: [],
    },
    permissions: "read",
    execute: (params) =>
      executeMemoryRecall(db, params as Record<string, unknown>),
  };

  return {
    id: "memory",
    name: "Memory",
    type: "tool",
    description: "Persistent key-value memory store",
    tools: [store, recall],
    afterToolCall: (toolName, params, _context, result) => {
      const { key, query } = params as { key?: string; query?: string };
      if (toolName === "memory_store" && result.success) {
        log.debug({ key }, "Memory stored");
      } else if (toolName === "memory_recall") {
        log.debug({ query, found: result.success }, "Memory recalled");
      }
    },
  };
}
