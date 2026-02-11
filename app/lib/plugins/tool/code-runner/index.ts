import { createContext, runInNewContext } from "node:vm";
import type { Tool, ToolPlugin } from "~/lib/types";
import type { Logger } from "~/lib/logger";

const EXECUTION_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_CHARS = 50_000;

// ---------------------------------------------------------------------------
// run_javascript
// ---------------------------------------------------------------------------

const runJavascriptTool: Tool = {
  name: "run_javascript",
  description:
    "Execute JavaScript code in a sandboxed environment and return the result. " +
    "Useful for calculations, data transformations, JSON processing, string manipulation, " +
    "and any computation that benefits from code execution. " +
    "The sandbox provides console.log, JSON, Math, Date, URL, Buffer, Map, Set, RegExp, " +
    "Array, Object, Promise, TextEncoder, TextDecoder, setTimeout, and parseInt/parseFloat. " +
    "The return value of the last expression is captured and returned.",
  keywords: [
    "code",
    "execute",
    "run",
    "javascript",
    "calculate",
    "compute",
    "script",
    "eval",
    "transform",
    "process",
    "data",
    "math",
  ],
  parameters: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "The JavaScript code to execute.",
      },
    },
    required: ["code"],
  },
  permissions: "write",

  execute(params) {
    const { code } = params as { code: string };

    if (!code.trim()) {
      return { success: false, error: "Code cannot be empty." };
    }

    const logs: string[] = [];

    const sandbox = {
      // Console capture
      console: {
        log: (...args: unknown[]) => logs.push(args.map(stringify).join(" ")),
        error: (...args: unknown[]) => logs.push(`[error] ${args.map(stringify).join(" ")}`),
        warn: (...args: unknown[]) => logs.push(`[warn] ${args.map(stringify).join(" ")}`),
        info: (...args: unknown[]) => logs.push(`[info] ${args.map(stringify).join(" ")}`),
      },

      // Standard globals
      JSON,
      Math,
      Date,
      Buffer,
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      Array,
      Object,
      Map,
      Set,
      WeakMap,
      WeakSet,
      RegExp,
      Promise,
      Symbol,
      Error,
      TypeError,
      RangeError,
      SyntaxError,

      // Numeric
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      Number,
      BigInt,
      String,
      Boolean,

      // Encoding
      atob: globalThis.atob,
      btoa: globalThis.btoa,
      encodeURIComponent,
      decodeURIComponent,
      encodeURI,
      decodeURI,

      // Timers (limited)
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, Math.min(ms, EXECUTION_TIMEOUT_MS)),
      clearTimeout,
    };

    createContext(sandbox);

    try {
      const result: unknown = runInNewContext(code, sandbox, {
        timeout: EXECUTION_TIMEOUT_MS,
        filename: "megabot-sandbox.js",
        displayErrors: true,
      });

      const consoleOutput = logs.length > 0 ? logs.join("\n") : "";
      const returnValue = result !== undefined ? stringify(result) : "";

      let output = "";
      if (consoleOutput) {
        output += `[Console Output]\n${consoleOutput}`;
      }
      if (returnValue) {
        if (output) output += "\n\n";
        output += `[Return Value]\n${returnValue}`;
      }

      if (!output) {
        output = "(no output)";
      }

      const truncated = output.length > MAX_OUTPUT_CHARS;
      if (truncated) {
        output = output.slice(0, MAX_OUTPUT_CHARS);
      }

      return {
        success: true,
        data: truncated ? `${output}\n[Truncated to ${MAX_OUTPUT_CHARS} chars]` : output,
      };
    } catch (err) {
      const consoleOutput = logs.length > 0 ? `[Console Output]\n${logs.join("\n")}\n\n` : "";
      const message = err instanceof Error ? err.message : "Unknown execution error";
      return {
        success: false,
        error: `${consoleOutput}[Error] ${message}`,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "function") return `[Function: ${value.name || "anonymous"}]`;
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "bigint") return `${value}n`;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export function createCodeRunnerPlugin(logger: Logger): ToolPlugin {
  const log = logger.child({ plugin: "code-runner" });

  return {
    id: "code-runner",
    name: "Code Runner",
    type: "tool",
    description: "Execute JavaScript code in a sandboxed environment",
    tools: [runJavascriptTool],
    afterToolCall: (_toolName, _params, _context, result) => {
      if (result.success) {
        log.debug("Code executed successfully");
      } else {
        log.warn({ error: result.error }, "Code execution failed");
      }
    },
  };
}
