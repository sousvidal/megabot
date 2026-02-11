import { eq, and, lte } from "drizzle-orm";
import { inngest } from "../client";
import { getServer } from "~/lib/server/init";
import { AgentRunner, BASE_TOOL_NAMES } from "~/lib/core/agent-runner";
import { getSystemPrompt } from "~/lib/core/system-prompt";
import { scheduledTasks, agents } from "~/lib/db/schema";
import { logger } from "~/lib/logger";

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

            // Dispatch as agent spawn
            await inngest.send({
              name: "megabot/agent.spawn",
              data: {
                agentId: task.agentId,
                taskId: task.id,
                input: task.input,
                originConversationId: "",
                originMessageId: "",
                scheduledTaskId: task.id,
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

/**
 * Inngest function that handles scheduled tasks without a specific agent.
 * Runs the task input through the main bot's AgentRunner.
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

    await step.run("execute", async () => {
      const { db, modelRouter, toolRegistry, eventBus } = getServer();

      const runner = new AgentRunner(db, modelRouter, toolRegistry, eventBus);
      const systemPrompt = getSystemPrompt({ tools: BASE_TOOL_NAMES });

      const result = await runner.run({
        systemPrompt,
        initialMessages: [
          {
            role: "user",
            content:
              `[Scheduled Task: "${data.taskName}"]\n\n${data.input}\n\n` +
              `[This task was triggered by the scheduler. Complete it and provide a summary of what was done.]`,
          },
        ],
        tools: [...BASE_TOOL_NAMES],
      });

      log.info(
        { toolCallCount: result.toolCallCount, textLength: result.text.length },
        "Scheduled task completed"
      );

      return { text: result.text, toolCallCount: result.toolCallCount };
    });
  }
);
