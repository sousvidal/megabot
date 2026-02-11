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
   * Search tools by query string. Matches against name, description, and keywords.
   * Splits the query into individual words and scores tools by the number of
   * matching words. Returns results sorted by relevance (most matches first).
   */
  search(query: string): Tool[] {
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);

    if (words.length === 0) return this.getAll();

    const scored = this.getAll()
      .map((tool) => {
        const haystack = [
          tool.name.toLowerCase(),
          tool.description.toLowerCase(),
          ...(tool.keywords ?? []).map((k) => k.toLowerCase()),
        ].join(" ");

        const hits = words.filter((w) => haystack.includes(w)).length;
        return { tool, hits };
      })
      .filter(({ hits }) => hits > 0);

    scored.sort((a, b) => b.hits - a.hits);

    return scored.map(({ tool }) => tool);
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
