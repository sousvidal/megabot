import { exec } from "node:child_process";
import { platform } from "node:os";
import type { Tool, ToolPlugin } from "~/lib/types";
import type { Logger } from "~/lib/logger";

const EXEC_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// send_notification
// ---------------------------------------------------------------------------

const sendNotificationTool: Tool = {
  name: "send_notification",
  description:
    "Send an OS-native desktop notification. Use this to alert the user about completed tasks, " +
    "important updates, reminders, or anything that needs their attention — especially from " +
    "background agents or scheduled tasks.",
  keywords: [
    "notification",
    "notify",
    "alert",
    "remind",
    "reminder",
    "popup",
    "attention",
    "desktop",
    "toast",
  ],
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "The notification title.",
      },
      message: {
        type: "string",
        description: "The notification body text.",
      },
      sound: {
        type: "boolean",
        description: "Play a sound with the notification (macOS only). Defaults to false.",
      },
    },
    required: ["title", "message"],
  },
  permissions: "write",

  async execute(params) {
    const { title, message, sound = false } = params as {
      title: string;
      message: string;
      sound?: boolean;
    };

    const os = platform();

    try {
      let cmd: string;

      if (os === "darwin") {
        // macOS: use osascript
        const escapedTitle = title.replace(/"/g, '\\"');
        const escapedMessage = message.replace(/"/g, '\\"');
        const soundPart = sound ? ' sound name "default"' : "";
        cmd = `osascript -e 'display notification "${escapedMessage}" with title "${escapedTitle}"${soundPart}'`;
      } else if (os === "linux") {
        // Linux: use notify-send
        const escapedTitle = title.replace(/'/g, "'\\''");
        const escapedMessage = message.replace(/'/g, "'\\''");
        cmd = `notify-send '${escapedTitle}' '${escapedMessage}'`;
      } else {
        return {
          success: false,
          error: `Notifications not supported on platform: ${os}`,
        };
      }

      await new Promise<void>((resolve, reject) => {
        exec(cmd, { timeout: EXEC_TIMEOUT_MS }, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      return {
        success: true,
        data: `Notification sent: "${title}"`,
      };
    } catch (err) {
      const message_ = err instanceof Error ? err.message : "Failed to send notification";
      return { success: false, error: message_ };
    }
  },
};

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export function createNotificationsPlugin(logger: Logger): ToolPlugin {
  const log = logger.child({ plugin: "notifications" });

  return {
    id: "notifications",
    name: "Notifications",
    type: "tool",
    description: "Send OS-native desktop notifications",
    tools: [sendNotificationTool],
    afterToolCall: (_toolName, params, _context, result) => {
      const { title } = params as { title?: string };
      if (result.success) {
        log.debug({ title }, "Notification sent");
      } else {
        log.warn({ title, error: result.error }, "Notification failed");
      }
    },
  };
}
