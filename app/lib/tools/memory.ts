import type { Tool, ToolResult } from "~/lib/types";
import type { AppDatabase } from "~/lib/db";
import { config } from "~/lib/db/schema";
import { eq, like } from "drizzle-orm";

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

/**
 * Creates the memory_store and memory_recall tools.
 * Both need access to the database to persist/query memories.
 */
export function createMemoryTools(db: AppDatabase): { store: Tool; recall: Tool } {
  const store: Tool = {
    name: "memory_store",
    description:
      "Store a piece of information for later recall. Use this to remember facts, user preferences, important details, or anything that should persist across conversations. Keys should be descriptive (e.g. 'user_favorite_color', 'project_deadline').",
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
    execute: (params) => executeMemoryStore(db, params as Record<string, unknown>),
  };

  const recall: Tool = {
    name: "memory_recall",
    description:
      "Search stored memories by keyword. Returns all memories whose key matches the query. Use this to recall previously stored information like user preferences, names, dates, or facts.",
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
    execute: (params) => executeMemoryRecall(db, params as Record<string, unknown>),
  };

  return { store, recall };
}
