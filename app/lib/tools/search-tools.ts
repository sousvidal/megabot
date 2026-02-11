import type { Tool } from "~/lib/types";
import type { ToolRegistry } from "~/lib/core/tool-registry";

/**
 * Creates the search_tools meta-tool. Requires a reference to the tool registry
 * so it can search for tools at runtime.
 */
export function createSearchToolsTool(registry: ToolRegistry): Tool {
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

    async execute(params) {
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
