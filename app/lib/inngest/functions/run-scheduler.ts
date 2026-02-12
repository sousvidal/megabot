import { nanoid } from "nanoid";
import { eq, and, lte } from "drizzle-orm";
import { inngest } from "../client";
import { getServer } from "~/lib/server/init";
import { AgentRunner, BASE_TOOL_NAMES } from "~/lib/core/agent-runner";
import { getSystemPrompt } from "~/lib/core/system-prompt";
import {
  scheduledTasks,
  agents,
  conversations,
  messages,
  tasks,
} from "~/lib/db/schema";
import type { EventBus } from "~/lib/core/event-bus";
import { logger } from "~/lib/logger";

// ---------------------------------------------------------------------------
// Helper: create a conversation + seed message for a scheduled task run
// ---------------------------------------------------------------------------

function createScheduledConversation(
  db: ReturnType<typeof getServer>["db"],
  eventBus: EventBus,
  taskName: string,
  input: string,
  now: Date
): { conversationId: string; messageId: string } {
  const conversationId = nanoid();
  db.insert(conversations)
    .values({
      id: conversationId,
      title: `Scheduled: ${taskName}`,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  eventBus.emit(
    "conversation.created",
    "scheduler",
    { title: `Scheduled: ${taskName}` },
    { conversationId }
  );

  const messageId = nanoid();
  db.insert(messages)
    .values({
      id: messageId,
      conversationId,
      role: "user",
      content: input,
      createdAt: now,
    })
    .run();

  return { conversationId, messageId };
}

// ---------------------------------------------------------------------------
// runScheduler — cron that checks for due tasks every minute
// ---------------------------------------------------------------------------

/**
 * Inngest cron function that runs every minute.
 * Checks the scheduled_tasks table for tasks that are due and dispatches them.
 *
 * - Recurring tasks: matches cron expression against current time
 * - One-shot tasks: checks if the scheduled ISO date has passed
 *
 * For each due task, dispatches a `megabot/agent.spawn` event if it has an agentId,
 * otherwise dispatches a `megabot/scheduled-task.run` event for the main bot to handle.
 */
export const runScheduler = inngest.createFunction(
  {
    id: "run-scheduler",
    name: "Run Scheduler",
  },
  { cron: "* * * * *" }, // Every minute
  async ({ step }) => {
    const log = logger.child({ module: "inngest:run-scheduler" });

    await step.run("check-due-tasks", async () => {
      const { db, eventBus } = getServer();
      const now = new Date();

      // Find all active tasks where nextRunAt <= now
      const dueTasks = db
        .select()
        .from(scheduledTasks)
        .where(
          and(
            eq(scheduledTasks.status, "active"),
            lte(scheduledTasks.nextRunAt, now)
          )
        )
        .all();

      if (dueTasks.length === 0) {
        return { dispatched: 0 };
      }

      log.info({ count: dueTasks.length }, "Found due scheduled tasks");

      let dispatched = 0;

      for (const task of dueTasks) {
        try {
          if (task.agentId) {
            // Verify the agent still exists
            const agent = db
              .select({ id: agents.id })
              .from(agents)
              .where(eq(agents.id, task.agentId))
              .get();

            if (!agent) {
              log.warn(
                { taskId: task.id, agentId: task.agentId },
                "Scheduled task references missing agent — skipping"
              );
              continue;
            }

            // Create a conversation so runAgent can deliver results back
            const { conversationId, messageId } =
              createScheduledConversation(db, eventBus, task.name, task.input, now);

            // Dispatch as agent spawn with valid origin IDs
            await inngest.send({
              name: "megabot/agent.spawn",
              data: {
                agentId: task.agentId,
                taskId: task.id,
                input: task.input,
                originConversationId: conversationId,
                originMessageId: messageId,
              },
            });
          } else {
            // Dispatch as a scheduled task run (no specific agent)
            await inngest.send({
              name: "megabot/scheduled-task.run",
              data: {
                scheduledTaskId: task.id,
                input: task.input,
                taskName: task.name,
              },
            });
          }

          // Update last run and compute next run
          const nextRun = task.type === "recurring"
            ? new Date(now.getTime() + 60_000) // Will be refined on next scheduler tick
            : null;

          db.update(scheduledTasks)
            .set({
              lastRunAt: now,
              nextRunAt: nextRun,
              status: task.type === "one_shot" ? "completed" : "active",
            })
            .where(eq(scheduledTasks.id, task.id))
            .run();

          eventBus.emit(
            "cron.triggered",
            "scheduler",
            {
              scheduledTaskId: task.id,
              taskName: task.name,
              type: task.type,
              hasAgent: !!task.agentId,
            },
            {}
          );

          dispatched++;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          log.error(
            { taskId: task.id, error: message },
            "Failed to dispatch scheduled task"
          );
        }
      }

      log.info({ dispatched }, "Scheduled tasks dispatched");
      return { dispatched };
    });
  }
);

// ---------------------------------------------------------------------------
// runScheduledTask — executes a scheduled task with full agent capabilities
// ---------------------------------------------------------------------------

/**
 * Inngest function that handles scheduled tasks without a specific agent.
 * Creates a conversation, runs the task through AgentRunner with full tool
 * access, and notifies the user when done.
 *
 * Flow mirrors runAgent:
 * 1. Setup: create conversation, seed message, create task record
 * 2. Execute: run AgentRunner with conversationId, messageId, and tools
 * 3. Notify: send desktop notification, update task record, emit events
 */
export const runScheduledTask = inngest.createFunction(
  {
    id: "run-scheduled-task",
    name: "Run Scheduled Task",
    retries: 1,
  },
  { event: "megabot/scheduled-task.run" },
  async ({ event, step }) => {
    const data = event.data as {
      scheduledTaskId: string;
      input: string;
      taskName: string;
    };

    const log = logger.child({
      module: "inngest:run-scheduled-task",
      scheduledTaskId: data.scheduledTaskId,
    });

    log.info({ taskName: data.taskName }, "Running scheduled task");

    // --- Step 1: Setup ---
    const setup = await step.run("setup", () => {
      const { db, eventBus } = getServer();
      const now = new Date();

      // Create conversation and seed message
      const { conversationId, messageId } = createScheduledConversation(
        db,
        eventBus,
        data.taskName,
        data.input,
        now
      );

      // Create a task record for execution tracking
      const taskId = nanoid();
      db.insert(tasks)
        .values({
          id: taskId,
          type: "scheduled",
          status: "running",
          input: JSON.stringify({
            scheduledTaskId: data.scheduledTaskId,
            taskName: data.taskName,
            input: data.input,
          }),
          conversationId,
          originConversationId: conversationId,
          originMessageId: messageId,
          createdAt: now,
        })
        .run();

      eventBus.emit(
        "scheduled-task.started",
        "scheduler",
        {
          scheduledTaskId: data.scheduledTaskId,
          taskName: data.taskName,
          taskId,
          conversationId,
        },
        { conversationId }
      );

      log.info(
        { taskId, conversationId },
        "Scheduled task setup complete"
      );

      return { conversationId, messageId, taskId };
    });

    // --- Step 2: Execute ---
    const result = await step.run("execute", async () => {
      const { db, modelRouter, toolRegistry, eventBus } = getServer();

      const runner = new AgentRunner(db, modelRouter, toolRegistry, eventBus);
      const systemPrompt = getSystemPrompt({ tools: BASE_TOOL_NAMES });

      return runner.run({
        systemPrompt,
        initialMessages: [
          {
            role: "user",
            content:
              `[Scheduled Task: "${data.taskName}"]\n\n` +
              `${data.input}\n\n` +
              `[You are executing this task in the background. Use your tools to ACTUALLY PERFORM ` +
              `the requested action. Do NOT just describe what you would do — use tools to do it. ` +
              `If the task involves communicating with the user, use send_notification. ` +
              `If you need context from previous conversations, use list_conversations and ` +
              `get_conversation_messages.]`,
          },
        ],
        tools: [...BASE_TOOL_NAMES],
        conversationId: setup.conversationId,
        messageId: setup.messageId,
      });
    });

    log.info(
      {
        toolCallCount: result.toolCallCount,
        textLength: result.text.length,
        usage: result.usage,
      },
      "Scheduled task execution complete"
    );

    // --- Step 3: Notify and track ---
    await step.run("notify", async () => {
      const { db, toolRegistry, eventBus } = getServer();
      const now = new Date();

      // Send a guaranteed desktop notification
      await toolRegistry.execute(
        "send_notification",
        {
          title: `Scheduled: ${data.taskName}`,
          message:
            result.toolCallCount > 0
              ? `Task completed with ${result.toolCallCount} action(s).`
              : `Task completed.`,
          sound: false,
        },
        {}
      );

      // Update the task record
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
        .where(eq(tasks.id, setup.taskId))
        .run();

      eventBus.emit(
        "scheduled-task.completed",
        "scheduler",
        {
          scheduledTaskId: data.scheduledTaskId,
          taskName: data.taskName,
          taskId: setup.taskId,
          toolCallCount: result.toolCallCount,
          textLength: result.text.length,
        },
        { conversationId: setup.conversationId }
      );
    });

    log.info("Scheduled task completed successfully");
    return { taskId: setup.taskId, status: "completed" };
  }
);
