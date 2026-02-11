import { exec } from "node:child_process";
import { platform } from "node:os";
import type { Tool, ToolPlugin } from "~/lib/types";
import type { Logger } from "~/lib/logger";

const MAX_CLIPBOARD_CHARS = 50_000;
const EXEC_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Platform helpers
// ---------------------------------------------------------------------------

function getReadCommand(): string | null {
  switch (platform()) {
    case "darwin":
      return "pbpaste";
    case "linux":
      return "xclip -selection clipboard -o";
    default:
      return null;
  }
}

function getWriteCommand(): string | null {
  switch (platform()) {
    case "darwin":
      return "pbcopy";
    case "linux":
      return "xclip -selection clipboard";
    default:
      return null;
  }
}

function execPromise(cmd: string, input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = exec(
      cmd,
      { encoding: "utf-8", timeout: EXEC_TIMEOUT_MS },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      }
    );

    if (input !== undefined && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

// ---------------------------------------------------------------------------
// clipboard_read
// ---------------------------------------------------------------------------

const clipboardReadTool: Tool = {
  name: "clipboard_read",
  description:
    "Read the current text contents of the system clipboard. " +
    "Useful for accessing content the user has recently copied.",
  keywords: ["clipboard", "copy", "paste", "selection", "text", "read"],
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  permissions: "read",

  async execute() {
    const cmd = getReadCommand();
    if (!cmd) {
      return {
        success: false,
        error: `Clipboard not supported on platform: ${platform()}`,
      };
    }

    try {
      let content = await execPromise(cmd);

      const truncated = content.length > MAX_CLIPBOARD_CHARS;
      if (truncated) {
        content = content.slice(0, MAX_CLIPBOARD_CHARS);
      }

      if (content.length === 0) {
        return { success: true, data: "(clipboard is empty)" };
      }

      return {
        success: true,
        data: truncated
          ? `${content}\n[Truncated to ${MAX_CLIPBOARD_CHARS} chars]`
          : content,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to read clipboard";
      return { success: false, error: message };
    }
  },
};

// ---------------------------------------------------------------------------
// clipboard_write
// ---------------------------------------------------------------------------

const clipboardWriteTool: Tool = {
  name: "clipboard_write",
  description:
    "Write text to the system clipboard. The user can then paste it anywhere. " +
    "Useful for preparing content for the user to paste into other applications.",
  keywords: ["clipboard", "copy", "paste", "write", "text", "set"],
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "The text to write to the clipboard.",
      },
    },
    required: ["content"],
  },
  permissions: "write",

  async execute(params) {
    const { content } = params as { content: string };

    const cmd = getWriteCommand();
    if (!cmd) {
      return {
        success: false,
        error: `Clipboard not supported on platform: ${platform()}`,
      };
    }

    try {
      await execPromise(cmd, content);

      return {
        success: true,
        data: `Copied ${content.length} chars to clipboard.`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to write to clipboard";
      return { success: false, error: message };
    }
  },
};

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export function createClipboardPlugin(logger: Logger): ToolPlugin {
  const log = logger.child({ plugin: "clipboard" });

  return {
    id: "clipboard",
    name: "Clipboard",
    type: "tool",
    description: "Read from and write to the system clipboard",
    tools: [clipboardReadTool, clipboardWriteTool],
    afterToolCall: (toolName, _params, _context, result) => {
      if (result.success) {
        log.debug({ tool: toolName }, "Clipboard operation succeeded");
      } else {
        log.warn({ tool: toolName, error: result.error }, "Clipboard operation failed");
      }
    },
  };
}
