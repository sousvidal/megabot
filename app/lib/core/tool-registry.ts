import type { Tool, ToolContext, ToolResult } from "~/lib/types";

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool, pluginId: string): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, { ...tool, pluginId });
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Search tools by query string. Matches against name and description.
   * Simple substring matching for now — can be upgraded to fuzzy/semantic later.
   */
  search(query: string): Tool[] {
    const q = query.toLowerCase();
    return this.getAll().filter(
      (tool) =>
        tool.name.toLowerCase().includes(q) ||
        tool.description.toLowerCase().includes(q)
    );
  }

  async execute(
    name: string,
    params: unknown,
    context: ToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Tool "${name}" not found` };
    }
    try {
      return await tool.execute(params, context);
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }
}
