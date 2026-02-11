import { createDatabase, type AppDatabase } from "~/lib/db";
import { PluginRegistry } from "~/lib/core/plugin-registry";
import { ToolRegistry } from "~/lib/core/tool-registry";
import { ModelRouter } from "~/lib/core/model-router";
import { EventBus } from "~/lib/core/event-bus";
import { createAnthropicPlugin } from "~/lib/plugins/anthropic";
import {
  getCurrentTimeTool,
  createSearchToolsTool,
  webFetchTool,
  runCommandTool,
  createMemoryTools,
} from "~/lib/tools";

export interface MegaBotServer {
  db: AppDatabase;
  pluginRegistry: PluginRegistry;
  toolRegistry: ToolRegistry;
  modelRouter: ModelRouter;
  eventBus: EventBus;
}

declare global {
  // eslint-disable-next-line no-var
  var __megabot: MegaBotServer | undefined;
}

/**
 * Get the shared MegaBot server instance.
 * Uses globalThis to survive Vite HMR in development.
 */
export function getServer(): MegaBotServer {
  if (!globalThis.__megabot) {
    const dbPath = process.env.DATABASE_PATH || "./data/megabot.db";
    const db = createDatabase(dbPath);

    const pluginRegistry = new PluginRegistry();
    const toolRegistry = new ToolRegistry();
    const eventBus = new EventBus();

    // Register LLM plugins
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      pluginRegistry.register(createAnthropicPlugin(anthropicKey));
    }

    // Register tools
    toolRegistry.register(getCurrentTimeTool, "system");
    toolRegistry.register(createSearchToolsTool(toolRegistry), "system");
    toolRegistry.register(webFetchTool, "system");
    toolRegistry.register(runCommandTool, "system");

    const { store, recall } = createMemoryTools(db);
    toolRegistry.register(store, "system");
    toolRegistry.register(recall, "system");

    const modelRouter = new ModelRouter(pluginRegistry);

    globalThis.__megabot = {
      db,
      pluginRegistry,
      toolRegistry,
      modelRouter,
      eventBus,
    };
  }

  return globalThis.__megabot;
}
