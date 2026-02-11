import type { Tool, ToolPlugin } from "~/lib/types";
import type { ToolRegistry } from "~/lib/core/tool-registry";
import type { Logger } from "~/lib/logger";

// ---------------------------------------------------------------------------
// get_current_time
// ---------------------------------------------------------------------------

const getCurrentTimeTool: Tool = {
  name: "get_current_time",
  description:
    "Returns the current date and time with timezone information. Useful when you need to know what time it is, calculate deadlines, or include timestamps.",
  parameters: {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description:
          'IANA timezone string (e.g. "America/New_York", "Europe/Amsterdam"). Defaults to system timezone.',
      },
    },
    required: [],
  },
  permissions: "none",

  execute(params) {
    const { timezone } = params as { timezone?: string };

    const now = new Date();
    const options: Intl.DateTimeFormatOptions = {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "long",
    };

    if (timezone) {
      options.timeZone = timezone;
    }

    const formatted = now.toLocaleString("en-US", options);
    const iso = now.toISOString();

    return {
      success: true,
      data: `${formatted} (ISO: ${iso})`,
    };
  },
};

// ---------------------------------------------------------------------------
// search_tools
// ---------------------------------------------------------------------------

function createSearchToolsTool(registry: ToolRegistry): Tool {
  return {
    name: "search_tools",
    description:
      "Search for available tools by keyword. Returns matching tool names and descriptions. Use this to discover what capabilities are available before deciding which tool to call.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query to match against tool names and descriptions.",
        },
      },
      required: ["query"],
    },
    permissions: "none",

    execute(params) {
      const { query } = params as { query: string };

      const results = registry.search(query);

      if (results.length === 0) {
        return {
          success: true,
          data: `No tools found matching "${query}".`,
        };
      }

      const formatted = results.map(
        (t) => `- **${t.name}**: ${t.description}`
      );

      return {
        success: true,
        data: `Found ${results.length} tool(s):\n${formatted.join("\n")}`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export function createSystemPlugin(
  toolRegistry: ToolRegistry,
  logger: Logger
): ToolPlugin {
  const log = logger.child({ plugin: "system" });

  return {
    id: "system",
    name: "System",
    type: "tool",
    description: "Core system utilities (time, tool discovery)",
    tools: [getCurrentTimeTool, createSearchToolsTool(toolRegistry)],
    afterToolCall: (_toolName, _params, _context, result) => {
      if (!result.success) {
        log.warn({ tool: _toolName, error: result.error }, "System tool failed");
      }
    },
  };
}
