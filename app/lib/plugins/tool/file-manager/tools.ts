import { readFile, writeFile, mkdir, rename, rm, stat, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { Tool } from "~/lib/types";
import {
  isBlockedPath,
  isGrayAreaPath,
  formatBytes,
  escapeShellArg,
  execPromise,
  commandExists,
  MAX_READ_CHARS,
  MAX_SEARCH_OUTPUT,
} from "./helpers";

// ---------------------------------------------------------------------------
// read_file
// ---------------------------------------------------------------------------

export const readFileTool: Tool = {
  name: "read_file",
  description:
    "Read the contents of a file. Optionally specify a line range with offset and limit. " +
    "Returns the file contents as text, truncated if very large.",
  keywords: ["file", "read", "cat", "view", "content", "text", "open", "load"],
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the file.",
      },
      offset: {
        type: "number",
        description: "Line number to start reading from (1-based). Omit to read from the beginning.",
      },
      limit: {
        type: "number",
        description: "Maximum number of lines to read. Omit to read all lines.",
      },
    },
    required: ["path"],
  },
  permissions: "read",

  async execute(params) {
    const { path: filePath, offset, limit } = params as {
      path: string;
      offset?: number;
      limit?: number;
    };

    try {
      const abs = resolve(filePath);
      const info = await stat(abs);

      if (!info.isFile()) {
        return { success: false, error: `"${abs}" is not a file.` };
      }

      let content = await readFile(abs, "utf-8");

      if (offset !== undefined || limit !== undefined) {
        const lines = content.split("\n");
        const start = Math.max(0, (offset ?? 1) - 1);
        const end = limit !== undefined ? start + limit : lines.length;
        const sliced = lines.slice(start, end);
        content = sliced.map((line, i) => `${start + i + 1} | ${line}`).join("\n");
      }

      const truncated = content.length > MAX_READ_CHARS;
      if (truncated) {
        content = content.slice(0, MAX_READ_CHARS);
      }

      return {
        success: true,
        data: truncated
          ? `${content}\n[Truncated to ${MAX_READ_CHARS} chars — file has more content]`
          : content,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error reading file";
      return { success: false, error: message };
    }
  },
};

// ---------------------------------------------------------------------------
// write_file
// ---------------------------------------------------------------------------
export const writeFileTool: Tool = {
  name: "write_file",
  description:
    "Create or overwrite a file at the specified path. " +
    "Intermediate directories are created automatically. " +
    "Use edit_file for partial modifications instead.",
  keywords: ["file", "write", "create", "save", "new", "overwrite", "output"],
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path for the file.",
      },
      content: {
        type: "string",
        description: "The full content to write to the file.",
      },
    },
    required: ["path", "content"],
  },
  permissions: "write",

  async execute(params) {
    const { path: filePath, content } = params as {
      path: string;
      content: string;
    };

    try {
      const abs = resolve(filePath);

      if (isBlockedPath(abs)) {
        return { success: false, error: `Refusing to write to protected path: "${abs}"` };
      }

      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf-8");

      return {
        success: true,
        data: `File written: ${abs} (${content.length} chars)`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error writing file";
      return { success: false, error: message };
    }
  },
};

// ---------------------------------------------------------------------------
// edit_file
// ---------------------------------------------------------------------------
export const editFileTool: Tool = {
  name: "edit_file",
  description:
    "Perform a search-and-replace within a file. Finds the first occurrence of " +
    "the search string and replaces it. Use for targeted edits without rewriting the whole file.",
  keywords: ["file", "edit", "modify", "replace", "update", "change", "patch", "sed"],
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to edit.",
      },
      search: {
        type: "string",
        description: "The exact text to find in the file.",
      },
      replace: {
        type: "string",
        description: "The text to replace it with.",
      },
      replaceAll: {
        type: "boolean",
        description: "Replace all occurrences instead of just the first. Defaults to false.",
      },
    },
    required: ["path", "search", "replace"],
  },
  permissions: "write",

  async execute(params) {
    const { path: filePath, search, replace, replaceAll = false } = params as {
      path: string;
      search: string;
      replace: string;
      replaceAll?: boolean;
    };

    try {
      const abs = resolve(filePath);
      let content = await readFile(abs, "utf-8");

      if (!content.includes(search)) {
        return {
          success: false,
          error: `Search string not found in "${abs}". Make sure the string matches exactly (including whitespace).`,
        };
      }

      if (replaceAll) {
        content = content.split(search).join(replace);
      } else {
        const idx = content.indexOf(search);
        content = content.slice(0, idx) + replace + content.slice(idx + search.length);
      }

      await writeFile(abs, content, "utf-8");

      return {
        success: true,
        data: `File edited: ${abs}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error editing file";
      return { success: false, error: message };
    }
  },
};

// ---------------------------------------------------------------------------
// list_directory
// ---------------------------------------------------------------------------
export const listDirectoryTool: Tool = {
  name: "list_directory",
  description:
    "List the contents of a directory, including file type (file/directory/symlink), " +
    "size, and last modified date.",
  keywords: ["directory", "folder", "list", "ls", "contents", "browse", "tree", "files"],
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the directory. Defaults to current working directory.",
      },
      showHidden: {
        type: "boolean",
        description: "Include hidden files (starting with '.'). Defaults to false.",
      },
    },
    required: [],
  },
  permissions: "read",

  async execute(params) {
    const { path: dirPath = ".", showHidden = false } = params as {
      path?: string;
      showHidden?: boolean;
    };

    try {
      const abs = resolve(dirPath);
      const entries = await readdir(abs, { withFileTypes: true });

      const filtered = showHidden
        ? entries
        : entries.filter((e) => !e.name.startsWith("."));

      const results: string[] = [];

      for (const entry of filtered.sort((a, b) => a.name.localeCompare(b.name))) {
        const fullPath = resolve(abs, entry.name);
        let type = "file";
        let size = "";
        let modified = "";

        try {
          const info = await stat(fullPath);
          if (entry.isDirectory()) type = "dir";
          else if (entry.isSymbolicLink()) type = "link";
          size = formatBytes(info.size);
          modified = info.mtime.toISOString().slice(0, 16).replace("T", " ");
        } catch {
          type = entry.isDirectory() ? "dir" : "file";
        }

        const suffix = type === "dir" ? "/" : "";
        results.push(`${type.padEnd(4)}  ${size.padStart(10)}  ${modified}  ${entry.name}${suffix}`);
      }

      return {
        success: true,
        data: `${abs}/\n${results.length === 0 ? "(empty directory)" : results.join("\n")}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error listing directory";
      return { success: false, error: message };
    }
  },
};

// ---------------------------------------------------------------------------
// search_files
// ---------------------------------------------------------------------------

export const grepTool: Tool = {
  name: "grep",
  description:
    "Recursively search for text content within files in a directory. " +
    "Uses ripgrep (rg) if available, otherwise falls back to grep. " +
    "Returns matching lines with file paths and line numbers.",
  keywords: ["search", "find", "grep", "ripgrep", "content", "text", "code", "pattern", "search_files"],
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The text or pattern to search for.",
      },
      path: {
        type: "string",
        description: "Directory to search in. Defaults to current working directory.",
      },
      glob: {
        type: "string",
        description: 'Optional file glob filter (e.g. "*.ts", "*.md").',
      },
      maxResults: {
        type: "number",
        description: "Maximum number of matches to return. Defaults to 50.",
      },
    },
    required: ["query"],
  },
  permissions: "read",

  async execute(params) {
    const { query, path: searchPath = ".", glob, maxResults = 50 } = params as {
      query: string;
      path?: string;
      glob?: string;
      maxResults?: number;
    };

    const abs = resolve(searchPath);

    // Try ripgrep first, fallback to grep
    const globArg = glob ? `--glob '${glob}'` : "";
    const rgCmd = `rg --no-heading --line-number --max-count ${maxResults} ${globArg} -- ${escapeShellArg(query)} ${escapeShellArg(abs)}`;
    const grepCmd = `grep -rn --max-count=${maxResults} ${glob ? `--include='${glob}'` : ""} -- ${escapeShellArg(query)} ${escapeShellArg(abs)}`;

    const cmd = await commandExists("rg") ? rgCmd : grepCmd;

    try {
      const output = await execPromise(cmd, { timeout: 15_000 });

      let result = output.trim();
      const truncated = result.length > MAX_SEARCH_OUTPUT;
      if (truncated) {
        result = result.slice(0, MAX_SEARCH_OUTPUT);
      }

      if (result.length === 0) {
        return { success: true, data: `No matches found for "${query}" in ${abs}` };
      }

      return {
        success: true,
        data: truncated ? `${result}\n[Truncated]` : result,
      };
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && (err as { code: number }).code === 1) {
        return { success: true, data: `No matches found for "${query}" in ${abs}` };
      }
      const message = err instanceof Error ? err.message : "Search failed";
      return { success: false, error: message };
    }
  },
};

// ---------------------------------------------------------------------------
// move_file
// ---------------------------------------------------------------------------

export const moveFileTool: Tool = {
  name: "move_file",
  description:
    "Move or rename a file or directory. Creates intermediate directories for the destination if needed.",
  keywords: ["move", "rename", "mv", "relocate", "file", "directory"],
  parameters: {
    type: "object",
    properties: {
      source: {
        type: "string",
        description: "Path to the source file or directory.",
      },
      destination: {
        type: "string",
        description: "Path to the destination.",
      },
    },
    required: ["source", "destination"],
  },
  permissions: "write",

  async execute(params) {
    const { source, destination } = params as {
      source: string;
      destination: string;
    };

    try {
      const srcAbs = resolve(source);
      const dstAbs = resolve(destination);

      // Ensure source exists
      await stat(srcAbs);

      // Ensure destination parent exists
      await mkdir(dirname(dstAbs), { recursive: true });

      await rename(srcAbs, dstAbs);

      return {
        success: true,
        data: `Moved: ${srcAbs} → ${dstAbs}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error moving file";
      return { success: false, error: message };
    }
  },
};

// ---------------------------------------------------------------------------
// delete_file
// ---------------------------------------------------------------------------

export const deleteFileTool: Tool = {
  name: "delete_file",
  description:
    "Delete a file or empty directory. Blocks deletion of system-critical paths. " +
    "For potentially risky paths, returns a confirmation prompt instead of deleting — " +
    "the user should confirm before retrying.",
  keywords: ["delete", "remove", "rm", "unlink", "cleanup", "file", "directory"],
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file or empty directory to delete.",
      },
      confirmed: {
        type: "boolean",
        description: "Set to true to confirm deletion of a risky path after user approval.",
      },
    },
    required: ["path"],
  },
  permissions: "admin",

  async execute(params) {
    const { path: filePath, confirmed = false } = params as {
      path: string;
      confirmed?: boolean;
    };

    try {
      const abs = resolve(filePath);

      // Hard block on dangerous paths
      if (isBlockedPath(abs)) {
        return {
          success: false,
          error: `Refusing to delete protected path: "${abs}". This path is permanently blocked.`,
        };
      }

      // Gray area check — require confirmation
      if (!confirmed) {
        const check = isGrayAreaPath(abs);
        if (check.risky) {
          return {
            success: false,
            error:
              `This deletion needs user confirmation: ${check.reason}. ` +
              `Ask the user if they want to proceed, then call delete_file again with confirmed: true.`,
          };
        }
      }

      const info = await stat(abs);

      if (info.isDirectory()) {
        const entries = await readdir(abs);
        if (entries.length > 0) {
          return {
            success: false,
            error: `Directory "${abs}" is not empty (${entries.length} items). Refusing to delete non-empty directories.`,
          };
        }
      }

      await rm(abs, { force: false });

      return {
        success: true,
        data: `Deleted: ${abs}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error deleting file";
      return { success: false, error: message };
    }
  },
};
