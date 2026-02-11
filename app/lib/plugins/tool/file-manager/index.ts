import type { ToolPlugin } from "~/lib/types";
import type { Logger } from "~/lib/logger";
import {
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirectoryTool,
  grepTool,
  moveFileTool,
  deleteFileTool,
} from "./tools";

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export function createFileManagerPlugin(logger: Logger): ToolPlugin {
  const log = logger.child({ plugin: "file-manager" });

  return {
    id: "file-manager",
    name: "File Manager",
    type: "tool",
    description: "Read, write, edit, search, move, and delete files and directories",
    tools: [
      readFileTool,
      writeFileTool,
      editFileTool,
      listDirectoryTool,
      grepTool,
      moveFileTool,
      deleteFileTool,
    ],
    afterToolCall: (toolName, params, _context, result) => {
      const { path: p, source } = params as { path?: string; source?: string };
      const target = p ?? source ?? "unknown";
      if (result.success) {
        log.debug({ tool: toolName, path: target }, "File operation succeeded");
      } else {
        log.warn({ tool: toolName, path: target, error: result.error }, "File operation failed");
      }
    },
  };
}
