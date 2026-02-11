import { exec } from "node:child_process";
import type { Tool, ToolPlugin } from "~/lib/types";
import type { Logger } from "~/lib/logger";

/**
 * Allowlist of safe, read-only commands.
 * Only the base command (first word) is checked against this list.
 */
const ALLOWED_COMMANDS = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "grep",
  "rg",
  "find",
  "wc",
  "echo",
  "pwd",
  "whoami",
  "date",
  "file",
  "stat",
  "which",
  "ps",
  "df",
  "du",
  "uname",
  "uptime",
  "hostname",
  "env",
  "printenv",
  "tree",
  "sort",
  "uniq",
  "cut",
  "awk",
  "sed", // read-only piped use is common
  "tr",
  "diff",
  "md5sum",
  "shasum",
  "sha256sum",
  "base64",
  "jq",
  "curl", // read-only fetching
  "wget", // read-only fetching
]);

const MAX_OUTPUT_CHARS = 50_000;
const EXEC_TIMEOUT_MS = 30_000;

const runCommandTool: Tool = {
  name: "run_command",
  description:
    "Execute a shell command on the local machine and return stdout/stderr. Restricted to read-only commands (ls, cat, grep, find, ps, df, etc.). Use this to explore the file system, inspect files, search for content, and gather system information.",
  keywords: [
    "file",
    "directory",
    "folder",
    "search",
    "find",
    "list",
    "read",
    "filesystem",
    "path",
    "document",
    "terminal",
    "shell",
  ],
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute.",
      },
    },
    required: ["command"],
  },
  permissions: "read",

  async execute(params) {
    const { command } = params as { command: string };

    if (!command || command.trim().length === 0) {
      return { success: false, error: "Command cannot be empty." };
    }

    // Extract the base command (handle pipes — check every command in the pipeline)
    const pipeSegments = command.split("|").map((s) => s.trim());
    for (const segment of pipeSegments) {
      const baseCmd = segment.split(/\s+/)[0];
      if (!baseCmd || !ALLOWED_COMMANDS.has(baseCmd)) {
        return {
          success: false,
          error: `Command "${baseCmd}" is not in the allowlist. Allowed: ${[...ALLOWED_COMMANDS].sort().join(", ")}`,
        };
      }
    }

    // Strip safe stderr redirections before checking dangerous patterns
    const sanitised = command
      .replace(/2>\s*\/dev\/null/g, "")
      .replace(/2>&1/g, "");

    // Block obvious dangerous patterns even with allowed commands
    const dangerous = [
      />\s*\//, // redirect to absolute path
      />\s*~/, // redirect to home
      /`[^`]*`/, // backtick subshells
      /\$\(/, // command substitution
      /;\s*/, // command chaining with semicolons
      /&&/, // command chaining with &&
      /\|\|/, // command chaining with ||
    ];

    for (const pattern of dangerous) {
      if (pattern.test(sanitised)) {
        return {
          success: false,
          error: `Command contains a blocked pattern: ${pattern.source}`,
        };
      }
    }

    try {
      const { stdout } = await new Promise<{
        stdout: string;
        stderr: string;
      }>((resolve, reject) => {
        exec(
          command,
          {
            encoding: "utf-8",
            timeout: EXEC_TIMEOUT_MS,
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          },
          (error, stdout, stderr) => {
            if (error) {
              reject(
                Object.assign(error, {
                  stdout: stdout ?? "",
                  stderr: stderr ?? "",
                })
              );
            } else {
              resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
            }
          }
        );
      });

      let output = stdout;
      const truncated = output.length > MAX_OUTPUT_CHARS;
      if (truncated) {
        output = output.slice(0, MAX_OUTPUT_CHARS);
      }

      return {
        success: true,
        data: truncated
          ? `${output}\n[Truncated to ${MAX_OUTPUT_CHARS} chars]`
          : output,
      };
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "stdout" in err &&
        "stderr" in err
      ) {
        const execErr = err as {
          stdout: string;
          stderr: string;
          status: number | null;
        };
        const stdout = execErr.stdout || "";
        const stderr = execErr.stderr || "";

        // If the command produced stdout, treat it as a partial success
        // (e.g. `find` returning results but hitting permission-denied dirs)
        if (stdout.trim().length > 0) {
          let output = stdout;
          const truncated = output.length > MAX_OUTPUT_CHARS;
          if (truncated) {
            output = output.slice(0, MAX_OUTPUT_CHARS);
          }
          const warning = stderr
            ? `\n[Warning: exit code ${execErr.status ?? "unknown"}, some errors on stderr]`
            : "";
          return {
            success: true,
            data: truncated
              ? `${output}\n[Truncated to ${MAX_OUTPUT_CHARS} chars]${warning}`
              : `${output}${warning}`,
          };
        }

        const output = stdout + stderr;
        return {
          success: false,
          error: `Exit code ${execErr.status ?? "unknown"}: ${output.slice(0, MAX_OUTPUT_CHARS)}`,
        };
      }
      const message =
        err instanceof Error ? err.message : "Unknown execution error";
      return { success: false, error: message };
    }
  },
};

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export function createRunCommandPlugin(logger: Logger): ToolPlugin {
  const log = logger.child({ plugin: "run-command" });

  return {
    id: "run-command",
    name: "Run Command",
    type: "tool",
    description: "Execute allowlisted shell commands",
    tools: [runCommandTool],
    beforeToolCall: (_toolName, params) => {
      const { command } = params as { command?: string };
      log.debug({ command }, "Executing command");
    },
    afterToolCall: (_toolName, params, _context, result) => {
      const { command } = params as { command?: string };
      if (!result.success) {
        log.warn({ command, error: result.error }, "Command failed");
      }
    },
  };
}
