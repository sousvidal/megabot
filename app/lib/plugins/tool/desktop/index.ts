import { exec } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { platform } from "node:os";
import type { Tool, ToolPlugin } from "~/lib/types";
import type { Logger } from "~/lib/logger";

const EXEC_TIMEOUT_MS = 10_000;

function execPromise(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: "utf-8", timeout: EXEC_TIMEOUT_MS }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function getOpenCommand(): string {
  return platform() === "darwin" ? "open" : "xdg-open";
}

// ---------------------------------------------------------------------------
// open_url
// ---------------------------------------------------------------------------

const openUrlTool: Tool = {
  name: "open_url",
  description:
    "Open a URL in the user's default web browser. " +
    "Use this to show the user a webpage, documentation, or any web resource.",
  keywords: ["open", "url", "browser", "link", "webpage", "website", "navigate"],
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to open (must start with http:// or https://).",
      },
    },
    required: ["url"],
  },
  permissions: "read",

  async execute(params) {
    const { url } = params as { url: string };

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return {
        success: false,
        error: `Invalid URL: "${url}". Must start with http:// or https://`,
      };
    }

    try {
      const escapedUrl = url.replace(/"/g, '\\"');
      await execPromise(`${getOpenCommand()} "${escapedUrl}"`);

      return {
        success: true,
        data: `Opened in browser: ${url}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open URL";
      return { success: false, error: message };
    }
  },
};

// ---------------------------------------------------------------------------
// open_application
// ---------------------------------------------------------------------------

const openApplicationTool: Tool = {
  name: "open_application",
  description:
    "Launch an application by name. On macOS, this opens .app bundles. " +
    "Examples: 'Safari', 'Visual Studio Code', 'Finder', 'Terminal', 'Slack'.",
  keywords: ["open", "launch", "start", "app", "application", "program", "run"],
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The application name (e.g. 'Safari', 'Slack', 'Terminal').",
      },
    },
    required: ["name"],
  },
  permissions: "write",

  async execute(params) {
    const { name } = params as { name: string };

    try {
      const os = platform();
      let cmd: string;

      if (os === "darwin") {
        const escapedName = name.replace(/"/g, '\\"');
        cmd = `open -a "${escapedName}"`;
      } else if (os === "linux") {
        // On Linux, try running the binary directly
        const escapedName = name.replace(/"/g, '\\"').toLowerCase();
        cmd = `${escapedName} &`;
      } else {
        return {
          success: false,
          error: `Application launching not supported on platform: ${os}`,
        };
      }

      await execPromise(cmd);

      return {
        success: true,
        data: `Launched application: ${name}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to launch application";
      return { success: false, error: message };
    }
  },
};

// ---------------------------------------------------------------------------
// open_file
// ---------------------------------------------------------------------------

const openFileTool: Tool = {
  name: "open_file",
  description:
    "Open a file in its default application. For example, a .pdf opens in Preview, " +
    "a .png opens in the image viewer, a .html opens in the browser.",
  keywords: ["open", "file", "launch", "view", "preview", "default", "application"],
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to open.",
      },
    },
    required: ["path"],
  },
  permissions: "read",

  async execute(params) {
    const { path: filePath } = params as { path: string };

    try {
      const abs = resolve(filePath);

      // Verify the file exists
      const info = await stat(abs);
      if (!info.isFile()) {
        return { success: false, error: `"${abs}" is not a file.` };
      }

      const escapedPath = abs.replace(/"/g, '\\"');
      await execPromise(`${getOpenCommand()} "${escapedPath}"`);

      return {
        success: true,
        data: `Opened file: ${abs}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open file";
      return { success: false, error: message };
    }
  },
};

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export function createDesktopPlugin(logger: Logger): ToolPlugin {
  const log = logger.child({ plugin: "desktop" });

  return {
    id: "desktop",
    name: "Desktop",
    type: "tool",
    description: "Open URLs, applications, and files on the desktop",
    tools: [openUrlTool, openApplicationTool, openFileTool],
    afterToolCall: (toolName, params, _context, result) => {
      const { url, name, path } = params as { url?: string; name?: string; path?: string };
      const target = url ?? name ?? path ?? "unknown";
      if (result.success) {
        log.debug({ tool: toolName, target }, "Desktop action succeeded");
      } else {
        log.warn({ tool: toolName, target, error: result.error }, "Desktop action failed");
      }
    },
  };
}
