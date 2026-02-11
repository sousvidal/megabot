import type { Plugin, LLMPlugin } from "~/lib/types";
import type {
  PluginType,
  CommPlugin,
  ToolPlugin,
} from "~/lib/types/plugin";
import type { ToolRegistry } from "./tool-registry";

export class PluginRegistry {
  private plugins = new Map<string, Plugin>();

  constructor(private toolRegistry?: ToolRegistry) {}

  /**
   * Register a plugin synchronously.
   * If a plugin needs async initialization, call plugin.initialize()
   * before registering it.
   *
   * ToolPlugin instances have their tools automatically registered in the
   * ToolRegistry. If the plugin defines beforeToolCall / afterToolCall hooks,
   * each tool's execute() is wrapped to run them transparently.
   */
  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin "${plugin.id}" is already registered`);
    }
    this.plugins.set(plugin.id, plugin);

    if (plugin.type === "tool" && this.toolRegistry) {
      for (const tool of plugin.tools) {
        const registeredTool = { ...tool };
        if (plugin.beforeToolCall || plugin.afterToolCall) {
          const originalExecute = tool.execute;
          registeredTool.execute = async (params, context) => {
            if (plugin.beforeToolCall)
              await plugin.beforeToolCall(tool.name, params, context);
            const result = await originalExecute(params, context);
            if (plugin.afterToolCall) {
              try {
                await plugin.afterToolCall(
                  tool.name,
                  params,
                  context,
                  result
                );
              } catch {
                // afterToolCall errors must not mask the tool result
              }
            }
            return result;
          };
        }
        this.toolRegistry.register(registeredTool, plugin.id);
      }
    }
  }

  unregister(id: string): boolean {
    const plugin = this.plugins.get(id);
    if (!plugin) return false;
    if (plugin.shutdown) void plugin.shutdown();
    // Clean up tools when a ToolPlugin is removed
    if (plugin.type === "tool" && this.toolRegistry) {
      for (const tool of plugin.tools) {
        this.toolRegistry.unregister(tool.name);
      }
    }
    return this.plugins.delete(id);
  }

  get(id: string): Plugin | undefined {
    return this.plugins.get(id);
  }

  getByType<T extends Plugin>(type: PluginType): T[] {
    return Array.from(this.plugins.values()).filter(
      (p) => p.type === type
    ) as T[];
  }

  getLLMPlugins(): LLMPlugin[] {
    return this.getByType<LLMPlugin>("llm");
  }

  getCommPlugins(): CommPlugin[] {
    return this.getByType<CommPlugin>("comm");
  }

  getToolPlugins(): ToolPlugin[] {
    return this.getByType<ToolPlugin>("tool");
  }

  getAll(): Plugin[] {
    return Array.from(this.plugins.values());
  }
}
