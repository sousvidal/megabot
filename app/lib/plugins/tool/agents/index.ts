import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "~/lib/db";
import { agents, tasks } from "~/lib/db/schema";
import type { ToolRegistry } from "~/lib/core/tool-registry";
import { inngest } from "~/lib/inngest/client";
import type { Tool, ToolPlugin } from "~/lib/types";
import type { Logger } from "~/lib/logger";

// ---------------------------------------------------------------------------
// create_agent
// ---------------------------------------------------------------------------

function buildCreateAgentTool(
  db: AppDatabase,
  toolRegistry: ToolRegistry
): Tool {
  return {
    name: "create_agent",
    description:
      "Define a new agent with its own system prompt and tool access. " +
      "Agents run in the background via Inngest and can use any registered tools. " +
      "Use this when a task would benefit from a dedicated, scoped assistant.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Short, descriptive agent name (e.g. 'research-agent')",
        },
        prompt: {
          type: "string",
          description:
            "System prompt for this agent. Define its role, goals, and constraints.",
        },
        tools: {
          type: "array",
          items: { type: "string" },
          description:
            "Tool names this agent can use. Use search_tools first to discover available tools.",
        },
        model: {
          type: "string",
          description:
            "Optional model ID override (e.g. 'anthropic:claude-sonnet-4-5-20250929')",
        },
        tier: {
          type: "string",
          enum: ["fast", "standard", "powerful"],
          description:
            "Model tier. 'fast' for quick tasks, 'standard' for general work, 'powerful' for complex reasoning.",
        },
      },
      required: ["name", "prompt", "tools"],
    },
    permissions: "write",
    execute(params) {
      const { name, prompt, tools, model, tier } = params as {
        name: string;
        prompt: string;
        tools: string[];
        model?: string;
        tier?: string;
      };

      const allTools = toolRegistry.getAll();
      const allToolNames = new Set(allTools.map((t) => t.name));
      const invalid = tools.filter((t) => !allToolNames.has(t));
      if (invalid.length > 0) {
        return {
          success: false,
          error: `Unknown tool(s): ${invalid.join(", ")}. Use search_tools to discover available tools.`,
        };
      }

      const id = nanoid();
      db.insert(agents)
        .values({
          id,
          name,
          prompt,
          tools: JSON.stringify(tools),
          model: model ?? null,
          tier: (tier as "fast" | "standard" | "powerful") ?? null,
          createdBy: "bot",
          createdAt: new Date(),
        })
        .run();

      return { success: true, data: { id, name, tools, model, tier } };
    },
  };
}

// ---------------------------------------------------------------------------
// list_agents
// ---------------------------------------------------------------------------

function buildListAgentsTool(db: AppDatabase): Tool {
  return {
    name: "list_agents",
    description:
      "List all defined agents. Returns their IDs, names, tools, and creation info.",
    parameters: {
      type: "object",
      properties: {
        createdBy: {
          type: "string",
          enum: ["system", "bot", "user"],
          description: "Optional filter by creator type",
        },
      },
      required: [],
    },
    permissions: "none",
    execute(params) {
      const { createdBy } = (params ?? {}) as { createdBy?: string };

      const query = createdBy
        ? db
            .select()
            .from(agents)
            .where(
              eq(agents.createdBy, createdBy as "system" | "bot" | "user")
            )
            .all()
        : db.select().from(agents).all();

      const result = query.map((a) => ({
        id: a.id,
        name: a.name,
        tools: a.tools ? (JSON.parse(a.tools) as string[]) : [],
        model: a.model,
        tier: a.tier,
        createdBy: a.createdBy,
        createdAt: a.createdAt,
      }));

      return { success: true, data: result };
    },
  };
}

// ---------------------------------------------------------------------------
// spawn_agent
// ---------------------------------------------------------------------------

function buildSpawnAgentTool(db: AppDatabase): Tool {
  return {
    name: "spawn_agent",
    description:
      "Run an agent in the background. The agent will execute its tool-call loop " +
      "and deliver the result back to the current conversation when done. " +
      "Returns immediately with a task ID.",
    parameters: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description:
            "ID of the agent to spawn (from create_agent or list_agents)",
        },
        input: {
          type: "string",
          description:
            "The task or question for the agent. Be specific about what you want it to do.",
        },
      },
      required: ["agentId", "input"],
    },
    permissions: "write",
    async execute(params, context) {
      const { agentId, input } = params as {
        agentId: string;
        input: string;
      };

      const agent = db
        .select({ id: agents.id, name: agents.name })
        .from(agents)
        .where(eq(agents.id, agentId))
        .get();

      if (!agent) {
        return {
          success: false,
          error: `Agent "${agentId}" not found. Use list_agents to see available agents.`,
        };
      }

      if (!context.conversationId) {
        return {
          success: false,
          error: "Cannot spawn agent outside of a conversation context.",
        };
      }

      if (!context.messageId) {
        return {
          success: false,
          error: "Missing message context for agent spawn.",
        };
      }

      const taskId = nanoid();
      db.insert(tasks)
        .values({
          id: taskId,
          type: "agent",
          status: "pending",
          input: JSON.stringify({ agentId, input }),
          agentId,
          originConversationId: context.conversationId,
          originMessageId: context.messageId,
          createdAt: new Date(),
        })
        .run();

      await inngest.send({
        name: "megabot/agent.spawn",
        data: {
          agentId,
          taskId,
          input,
          originConversationId: context.conversationId,
          originMessageId: context.messageId,
        },
      });

      return {
        success: true,
        data: {
          taskId,
          agentName: agent.name,
          status: "dispatched",
          message: `Agent "${agent.name}" has been dispatched. It will work in the background and deliver results when done.`,
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export function createAgentsPlugin(
  db: AppDatabase,
  toolRegistry: ToolRegistry,
  logger: Logger
): ToolPlugin {
  const log = logger.child({ plugin: "agents" });

  return {
    id: "agents",
    name: "Agents",
    type: "tool",
    description: "Create, list, and spawn background agents",
    tools: [
      buildCreateAgentTool(db, toolRegistry),
      buildListAgentsTool(db),
      buildSpawnAgentTool(db),
    ],
    afterToolCall: (toolName, params, _context, result) => {
      if (toolName === "create_agent" && result.success) {
        const { name } = params as { name?: string };
        log.info({ agentName: name }, "Agent created");
      } else if (toolName === "spawn_agent" && result.success) {
        const { agentId } = params as { agentId?: string };
        log.info({ agentId }, "Agent spawned");
      } else if (!result.success) {
        log.warn(
          { tool: toolName, error: result.error },
          "Agent tool failed"
        );
      }
    },
  };
}
