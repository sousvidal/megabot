import { createDatabase, type AppDatabase } from "~/lib/db";
import { PluginRegistry } from "~/lib/core/plugin-registry";
import { ToolRegistry } from "~/lib/core/tool-registry";
import { ModelRouter } from "~/lib/core/model-router";
import { EventBus } from "~/lib/core/event-bus";
import { ChatStreamManager } from "~/lib/core/chat-stream-manager";
import { logger } from "~/lib/logger";
import type { Logger } from "~/lib/logger";

// Plugins
import { createAnthropicPlugin } from "~/lib/plugins/llm/anthropic";
import { createSystemPlugin } from "~/lib/plugins/tool/system";
import { createWebFetchPlugin } from "~/lib/plugins/tool/web-fetch";
import { createRunCommandPlugin } from "~/lib/plugins/tool/run-command";
import { createMemoryPlugin } from "~/lib/plugins/tool/memory";
import { createAgentsPlugin } from "~/lib/plugins/tool/agents";

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

    const toolRegistry = new ToolRegistry();
    const pluginRegistry = new PluginRegistry(toolRegistry);
    const eventBus = new EventBus();

    // Register LLM plugins
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      pluginRegistry.register(createAnthropicPlugin(anthropicKey));
      logger.info("Anthropic plugin registered");
    } else {
      logger.warn("ANTHROPIC_API_KEY not set — no LLM provider available");
    }

    // Register tool plugins
    pluginRegistry.register(createSystemPlugin(toolRegistry, logger));
    pluginRegistry.register(createWebFetchPlugin(logger));
    pluginRegistry.register(createRunCommandPlugin(logger));
    pluginRegistry.register(createMemoryPlugin(db, logger));
    pluginRegistry.register(createAgentsPlugin(db, toolRegistry, logger));

    logger.info(
      { toolCount: toolRegistry.getAll().length },
      "Tool plugins registered"
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
