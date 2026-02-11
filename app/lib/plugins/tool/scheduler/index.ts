import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "~/lib/db";
import { scheduledTasks } from "~/lib/db/schema";
import type { Tool, ToolPlugin } from "~/lib/types";
import type { Logger } from "~/lib/logger";

// ---------------------------------------------------------------------------
// Cron expression parser / validator
// ---------------------------------------------------------------------------

const CRON_FIELD_RANGES: Array<{ name: string; min: number; max: number }> = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 7 },
];

function validateCronExpression(expr: string): string | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return `Cron expression must have exactly 5 fields (minute hour day month weekday), got ${parts.length}.`;
  }

  for (let i = 0; i < 5; i++) {
    const field = parts[i];
    const range = CRON_FIELD_RANGES[i];

    if (field === "*") continue;

    // Handle */N step syntax
    if (field.startsWith("*/")) {
      const step = parseInt(field.slice(2), 10);
      if (isNaN(step) || step < 1) {
        return `Invalid step value in ${range.name}: "${field}"`;
      }
      continue;
    }

    // Handle comma-separated values
    const values = field.split(",");
    for (const val of values) {
      // Handle ranges like 1-5
      if (val.includes("-")) {
        const [start, end] = val.split("-").map(Number);
        if (isNaN(start) || isNaN(end) || start < range.min || end > range.max || start > end) {
          return `Invalid range in ${range.name}: "${val}" (valid: ${range.min}-${range.max})`;
        }
        continue;
      }

      const num = parseInt(val, 10);
      if (isNaN(num) || num < range.min || num > range.max) {
        return `Invalid value in ${range.name}: "${val}" (valid: ${range.min}-${range.max})`;
      }
    }
  }

  return null;
}

/**
 * Compute the next run time from a cron expression relative to `from`.
 * This is a simplified implementation that handles common patterns.
 */
function computeNextRun(schedule: string, type: string, from: Date): Date | null {
  if (type === "one_shot") {
    const date = new Date(schedule);
    return isNaN(date.getTime()) ? null : date;
  }

  // For recurring cron, just add 1 minute as a rough next-run estimate.
  // The actual Inngest cron function handles precise matching.
  const next = new Date(from.getTime() + 60_000);
  return next;
}

// ---------------------------------------------------------------------------
// create_scheduled_task
// ---------------------------------------------------------------------------

interface ScheduleValidationResult {
  valid: boolean;
  error?: string;
}

function validateSchedule(schedule: string, type: "recurring" | "one_shot"): ScheduleValidationResult {
  if (type === "recurring") {
    const error = validateCronExpression(schedule);
    if (error) {
      return { valid: false, error: `Invalid cron expression: ${error}` };
    }
  } else {
    const date = new Date(schedule);
    if (isNaN(date.getTime())) {
      return { valid: false, error: `Invalid date: "${schedule}". Use ISO format (e.g. 2025-06-01T14:00:00Z).` };
    }
    if (date.getTime() < Date.now()) {
      return { valid: false, error: `Date "${schedule}" is in the past.` };
    }
  }
  return { valid: true };
}

interface CreateTaskParams {
  name: string;
  description?: string;
  schedule: string;
  type: "recurring" | "one_shot";
  input: string;
  agentId?: string;
}

function executeCreateTask(db: AppDatabase, params: CreateTaskParams) {
  const { name, description, schedule, type, input, agentId } = params;

  // Validate schedule
  const validation = validateSchedule(schedule, type);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const now = new Date();
  const id = nanoid();
  const nextRun = computeNextRun(schedule, type, now);

  db.insert(scheduledTasks)
    .values({
      id,
      name,
      description: description ?? null,
      schedule,
      type,
      agentId: agentId ?? null,
      input,
      status: "active",
      lastRunAt: null,
      nextRunAt: nextRun,
      createdAt: now,
    })
    .run();

  return {
    success: true,
    data: {
      id,
      name,
      type,
      schedule,
      status: "active",
      nextRunAt: nextRun?.toISOString() ?? null,
      message: type === "recurring"
        ? `Recurring task "${name}" scheduled with cron: ${schedule}`
        : `One-shot task "${name}" scheduled for: ${schedule}`,
    },
  };
}

function buildCreateScheduledTaskTool(db: AppDatabase): Tool {
  return {
    name: "create_scheduled_task",
    description:
      "Schedule a recurring or one-shot task. Recurring tasks use cron expressions " +
      "(e.g. '0 9 * * *' for daily at 9am, '*/30 * * * *' for every 30 minutes). " +
      "One-shot tasks use an ISO date string. The task input describes what to do, " +
      "and an optional agentId specifies which agent should run it. " +
      "Tasks are executed via Inngest in the background.",
    keywords: [
      "schedule",
      "cron",
      "recurring",
      "timer",
      "reminder",
      "periodic",
      "task",
      "automation",
      "routine",
    ],
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Short descriptive name for the task (e.g. 'morning-briefing', 'check-emails').",
        },
        description: {
          type: "string",
          description: "Optional longer description of what this task does.",
        },
        schedule: {
          type: "string",
          description:
            "Cron expression for recurring tasks (e.g. '0 9 * * 1-5' for weekdays at 9am) " +
            "or ISO date string for one-shot tasks (e.g. '2025-06-01T14:00:00Z').",
        },
        type: {
          type: "string",
          enum: ["recurring", "one_shot"],
          description: "Whether this task repeats on a schedule or runs once.",
        },
        input: {
          type: "string",
          description: "The task instruction — what should be done when this task triggers.",
        },
        agentId: {
          type: "string",
          description: "Optional agent ID to run this task. If omitted, the main bot handles it.",
        },
      },
      required: ["name", "schedule", "type", "input"],
    },
    permissions: "write",
    execute: (params) => executeCreateTask(db, params as CreateTaskParams),
  };
}

// ---------------------------------------------------------------------------
// list_scheduled_tasks
// ---------------------------------------------------------------------------

function buildListScheduledTasksTool(db: AppDatabase): Tool {
  return {
    name: "list_scheduled_tasks",
    description:
      "List all scheduled tasks with their status, schedule, and last run time.",
    keywords: [
      "schedule",
      "cron",
      "list",
      "tasks",
      "recurring",
      "timer",
      "automation",
    ],
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["active", "paused", "completed"],
          description: "Optional filter by status.",
        },
      },
      required: [],
    },
    permissions: "read",

    execute(params) {
      const { status } = (params ?? {}) as { status?: string };

      const query = status
        ? db
            .select()
            .from(scheduledTasks)
            .where(eq(scheduledTasks.status, status as "active" | "paused" | "completed"))
            .all()
        : db.select().from(scheduledTasks).all();

      const result = query.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        schedule: t.schedule,
        type: t.type,
        status: t.status,
        agentId: t.agentId,
        input: t.input.length > 200 ? `${t.input.slice(0, 200)}...` : t.input,
        lastRunAt: t.lastRunAt?.toISOString() ?? null,
        nextRunAt: t.nextRunAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
      }));

      if (result.length === 0) {
        return {
          success: true,
          data: status
            ? `No scheduled tasks with status "${status}".`
            : "No scheduled tasks found.",
        };
      }

      return { success: true, data: result };
    },
  };
}

// ---------------------------------------------------------------------------
// delete_scheduled_task
// ---------------------------------------------------------------------------

function buildDeleteScheduledTaskTool(db: AppDatabase): Tool {
  return {
    name: "delete_scheduled_task",
    description:
      "Delete a scheduled task by ID. The task will no longer be executed.",
    keywords: [
      "schedule",
      "cron",
      "delete",
      "remove",
      "cancel",
      "stop",
      "task",
    ],
    parameters: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The ID of the scheduled task to delete.",
        },
      },
      required: ["taskId"],
    },
    permissions: "write",

    execute(params) {
      const { taskId } = params as { taskId: string };

      const existing = db
        .select({ id: scheduledTasks.id, name: scheduledTasks.name })
        .from(scheduledTasks)
        .where(eq(scheduledTasks.id, taskId))
        .get();

      if (!existing) {
        return {
          success: false,
          error: `Scheduled task "${taskId}" not found. Use list_scheduled_tasks to see available tasks.`,
        };
      }

      db.delete(scheduledTasks).where(eq(scheduledTasks.id, taskId)).run();

      return {
        success: true,
        data: `Deleted scheduled task: "${existing.name}" (${taskId})`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export function createSchedulerPlugin(
  db: AppDatabase,
  logger: Logger
): ToolPlugin {
  const log = logger.child({ plugin: "scheduler" });

  return {
    id: "scheduler",
    name: "Scheduler",
    type: "tool",
    description: "Create, list, and delete scheduled tasks (cron and one-shot)",
    tools: [
      buildCreateScheduledTaskTool(db),
      buildListScheduledTasksTool(db),
      buildDeleteScheduledTaskTool(db),
    ],
    afterToolCall: (toolName, params, _context, result) => {
      if (toolName === "create_scheduled_task" && result.success) {
        const { name } = params as { name?: string };
        log.info({ taskName: name }, "Scheduled task created");
      } else if (toolName === "delete_scheduled_task" && result.success) {
        const { taskId } = params as { taskId?: string };
        log.info({ taskId }, "Scheduled task deleted");
      } else if (!result.success) {
        log.warn({ tool: toolName, error: result.error }, "Scheduler tool failed");
      }
    },
  };
}
