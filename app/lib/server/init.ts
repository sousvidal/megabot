import { createDatabase, type AppDatabase } from "~/lib/db";
import { PluginRegistry } from "~/lib/core/plugin-registry";
import { ToolRegistry } from "~/lib/core/tool-registry";
import { ModelRouter } from "~/lib/core/model-router";
import { EventBus } from "~/lib/core/event-bus";
import { ChatStreamManager } from "~/lib/core/chat-stream-manager";
import { createAnthropicPlugin } from "~/lib/plugins/anthropic";
import { logger } from "~/lib/logger";
import type { Logger } from "~/lib/logger";
import {
  getCurrentTimeTool,
  createSearchToolsTool,
  webFetchTool,
  runCommandTool,
  createMemoryTools,
  createAgentTools,
} from "~/lib/tools";

export interface MegaBotServer {
  db: AppDatabase;
  pluginRegistry: PluginRegistry;
  toolRegistry: ToolRegistry;
  modelRouter: ModelRouter;
  eventBus: EventBus;
  chatStreamManager: ChatStreamManager;
  logger: Logger;
}

declare global {
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
    logger.info({ dbPath }, "Database initialized");

    const pluginRegistry = new PluginRegistry();
    const toolRegistry = new ToolRegistry();
    const eventBus = new EventBus();

    // Register LLM plugins
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      pluginRegistry.register(createAnthropicPlugin(anthropicKey));
      logger.info("Anthropic plugin registered");
    } else {
      logger.warn("ANTHROPIC_API_KEY not set — no LLM provider available");
    }

    // Register tools
    toolRegistry.register(getCurrentTimeTool, "system");
    toolRegistry.register(createSearchToolsTool(toolRegistry), "system");
    toolRegistry.register(webFetchTool, "system");
    toolRegistry.register(runCommandTool, "system");

    const { store, recall } = createMemoryTools(db);
    toolRegistry.register(store, "system");
    toolRegistry.register(recall, "system");

    const { createAgent, listAgents, spawnAgent } = createAgentTools(
      db,
      toolRegistry
    );
    toolRegistry.register(createAgent, "system");
    toolRegistry.register(listAgents, "system");
    toolRegistry.register(spawnAgent, "system");

    logger.info(
      { toolCount: toolRegistry.getAll().length },
      "Tools registered"
    );

    const modelRouter = new ModelRouter(pluginRegistry);
    const chatStreamManager = new ChatStreamManager();

    // Bridge EventBus events to the logger
    eventBus.onAny((event) => {
      const child = logger.child({
        eventType: event.type,
        source: event.source,
        ...(event.conversationId && { conversationId: event.conversationId }),
        ...(event.agentId && { agentId: event.agentId }),
      });
      child[event.level](event.data, event.type);
    });

    logger.info("MegaBot server initialized");

    globalThis.__megabot = {
      db,
      pluginRegistry,
      toolRegistry,
      modelRouter,
      eventBus,
      chatStreamManager,
      logger,
    };
  }

  // Patch in chatStreamManager if the singleton predates it (Vite HMR)
  if (!globalThis.__megabot.chatStreamManager) {
    globalThis.__megabot.chatStreamManager = new ChatStreamManager();
  }

  return globalThis.__megabot;
}
