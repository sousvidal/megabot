import { nanoid } from "nanoid";
import { eq, and, gt } from "drizzle-orm";
import { inngest } from "../client";
import { getServer } from "~/lib/server/init";
import { AgentRunner, BASE_TOOL_NAMES } from "~/lib/core/agent-runner";
import { getSystemPrompt } from "~/lib/core/system-prompt";
import { conversations, messages, tasks, agents } from "~/lib/db/schema";
import { truncateHistory } from "~/lib/core/chat-handler-utils";
import type { LLMMessage, ContentBlock } from "~/lib/types";
import { logger } from "~/lib/logger";

interface AgentSpawnData {
  agentId: string;
  taskId: string;
  input: string;
  originConversationId: string;
  originMessageId: string;
}

/**
 * Inngest function that executes an agent in the background.
 *
 * Flow:
 * 1. Load the agent definition and create a conversation for its work
 * 2. Run the agent's tool-call loop via AgentRunner
 * 3. Deliver the result back to the originating conversation
 */
export const runAgent = inngest.createFunction(
  {
    id: "run-agent",
    name: "Run Agent",
    retries: 1,
  },
  { event: "megabot/agent.spawn" },
  async ({ event, step }) => {
    const data = event.data as AgentSpawnData;
    const log = logger.child({
      module: "inngest:run-agent",
      agentId: data.agentId,
      taskId: data.taskId,
    });

    log.info("Agent spawn started");

    // --- Step 1: Setup ---
    const setup = await step.run("setup", () => {
      const { db, eventBus } = getServer();
      const now = new Date();

      // Load the agent definition
      const agent = db
        .select()
        .from(agents)
        .where(eq(agents.id, data.agentId))
        .get();

      if (!agent) {
        log.error({ agentId: data.agentId }, "Agent not found");
        throw new Error(`Agent "${data.agentId}" not found`);
      }

      // Create a conversation for the agent's work
      const agentConversationId = nanoid();
      db.insert(conversations)
        .values({
          id: agentConversationId,
          title: `Agent: ${agent.name}`,
          agentId: agent.id,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      // Seed the conversation with the input as a user message
      db.insert(messages)
        .values({
          id: nanoid(),
          conversationId: agentConversationId,
          role: "user",
          content: data.input,
          createdAt: now,
        })
        .run();

      // Update task status
      db.update(tasks)
        .set({ status: "running", conversationId: agentConversationId })
        .where(eq(tasks.id, data.taskId))
        .run();

      eventBus.emit(
        "agent.spawned",
        `agent:${agent.id}`,
        { agentName: agent.name, input: data.input, taskId: data.taskId },
        { conversationId: data.originConversationId, agentId: agent.id }
      );

      const agentTools: string[] = agent.tools
        ? (JSON.parse(agent.tools) as string[])
        : [];

      log.info(
        { agentName: agent.name, conversationId: agentConversationId, toolCount: agentTools.length },
        "Agent setup complete"
      );

      return {
        agentConversationId,
        agentName: agent.name,
        agentPrompt: agent.prompt,
        agentTools,
        agentModel: agent.model ?? undefined,
        agentTier: agent.tier ?? undefined,
      };
    });

    // --- Step 2: Execute the agent ---
    log.info({ agentName: setup.agentName }, "Agent execution starting");
    const result = await step.run("execute", async () => {
      const { db, modelRouter, toolRegistry, eventBus } = getServer();

      const runner = new AgentRunner(db, modelRouter, toolRegistry, eventBus);

      return runner.run({
        systemPrompt: setup.agentPrompt,
        initialMessages: [{ role: "user", content: data.input }],
        tools: setup.agentTools,
        modelId: setup.agentModel,
        tier: setup.agentTier,
        agentId: data.agentId,
        conversationId: setup.agentConversationId,
      });
    });

    log.info(
      { toolCallCount: result.toolCallCount, usage: result.usage, textLength: result.text.length },
      "Agent execution complete"
    );

    // --- Step 3: Deliver the result ---
    await step.run("deliver-result", async () => {
      const { db, modelRouter, toolRegistry, eventBus } = getServer();
      const now = new Date();

      // Check if user has moved on (sent any message after the origin message)
      const originMessage = db
        .select({ createdAt: messages.createdAt })
        .from(messages)
        .where(eq(messages.id, data.originMessageId))
        .get();

      const originTime = originMessage?.createdAt ?? new Date(0);

      const newerUserMessages = db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, data.originConversationId),
            eq(messages.role, "user"),
            gt(messages.createdAt, originTime)
          )
        )
        .all();

      const userMovedOn = newerUserMessages.length > 0;
      log.debug({ userMovedOn }, "Checked if user moved on");

      if (!userMovedOn) {
        // User is still waiting — synthesize a response using the main bot
        const historyRows = db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, data.originConversationId))
          .all();

        const llmMessages: LLMMessage[] = [];
        for (const row of historyRows) {
          if (row.toolCalls) {
            const blocks = JSON.parse(row.toolCalls) as ContentBlock[];
            if (row.role === "tool") {
              llmMessages.push({ role: "user", content: blocks });
            } else {
              llmMessages.push({
                role: row.role as "user" | "assistant",
                content: blocks,
              });
            }
          } else if (row.role !== "tool") {
            llmMessages.push({
              role: row.role as "user" | "assistant",
              content: row.content,
            });
          }
        }

        const truncated = truncateHistory(llmMessages, 400_000);

        // Add context about the agent's result
        truncated.push({
          role: "user",
          content:
            `[Agent "${setup.agentName}" has completed the task you dispatched. ` +
            `It made ${result.toolCallCount} tool call(s). Here is its output:]\n\n` +
            result.text +
            `\n\n[Please synthesize this into a natural response for the user. ` +
            `Reference the agent's findings directly — don't say "the agent found", ` +
            `just present the information as your own answer.]`,
        });

        const systemPrompt = getSystemPrompt({
          tools: BASE_TOOL_NAMES,
        });

        const runner = new AgentRunner(
          db,
          modelRouter,
          toolRegistry,
          eventBus
        );

        // Re-check before synthesis: has the user moved on in the meantime?
        const recheck = db
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.conversationId, data.originConversationId),
              eq(messages.role, "user"),
              gt(messages.createdAt, originTime)
            )
          )
          .all();

        if (recheck.length > 0) {
          // User moved on between our initial check and now — post notification instead
          log.info("User moved on during synthesis — posting notification");
          postNotification(db, data, setup.agentName, result.text, now);
        } else {
          log.info("Synthesizing agent result into conversation");
          // Synthesize response using full AgentRunner (tools available)
          await runner.run({
            systemPrompt,
            initialMessages: truncated,
            tools: [...BASE_TOOL_NAMES],
            conversationId: data.originConversationId,
          });
        }
      } else {
        // User moved on — post a notification message
        log.info("User moved on — posting notification");
        postNotification(db, data, setup.agentName, result.text, now);
      }

      // Update task to completed
      db.update(tasks)
        .set({
          status: "completed",
          result: JSON.stringify({
            text: result.text,
            toolCallCount: result.toolCallCount,
            usage: result.usage,
          }),
          completedAt: now,
        })
        .where(eq(tasks.id, data.taskId))
        .run();

      eventBus.emit(
        "agent.completed",
        `agent:${data.agentId}`,
        {
          agentName: setup.agentName,
          taskId: data.taskId,
          toolCallCount: result.toolCallCount,
          textLength: result.text.length,
        },
        { conversationId: data.originConversationId, agentId: data.agentId }
      );
    });

    log.info("Agent spawn completed successfully");
    return { taskId: data.taskId, status: "completed" };
  }
);

/**
 * Insert a notification message into the origin conversation
 * so the user knows the agent has finished.
 */
function postNotification(
  db: ReturnType<typeof getServer>["db"],
  data: AgentSpawnData,
  agentName: string,
  resultText: string,
  now: Date
): void {
  const notification = {
    type: "agent_result",
    taskId: data.taskId,
    agentId: data.agentId,
    agentName,
    summary: resultText.slice(0, 500),
  };

  db.insert(messages)
    .values({
      id: nanoid(),
      conversationId: data.originConversationId,
      role: "system",
      content: JSON.stringify(notification),
      createdAt: now,
    })
    .run();
}
