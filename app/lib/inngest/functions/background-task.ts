import { inngest } from "../client";

/**
 * Generic background task handler.
 * Triggered by dispatching a "megabot/task.dispatched" event.
 */
export const backgroundTask = inngest.createFunction(
  { id: "background-task", name: "Background Task" },
  { event: "megabot/task.dispatched" },
  async ({ event, step }) => {
    const { taskId, taskType, input } = event.data as {
      taskId: string;
      taskType: string;
      input: unknown;
    };

    const result = await step.run("execute-task", async () => {
      // Placeholder: task execution logic will be added as capabilities grow
      return {
        taskId,
        taskType,
        status: "completed" as const,
        result: `Task ${taskType} completed`,
        input,
      };
    });

    return result;
  }
);
