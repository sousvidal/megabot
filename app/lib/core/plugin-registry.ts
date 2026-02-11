import type { Plugin, LLMPlugin } from "~/lib/types";
import type {
  PluginType,
  CommPlugin,
  ToolPlugin,
} from "~/lib/types/plugin";

export class PluginRegistry {
  private plugins = new Map<string, Plugin>();

  /**
   * Register a plugin synchronously.
   * If a plugin needs async initialization, call plugin.initialize()
   * before registering it.
   */
  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Plugin "${plugin.id}" is already registered`);
    }
    this.plugins.set(plugin.id, plugin);
  }

  unregister(id: string): boolean {
    const plugin = this.plugins.get(id);
    if (plugin?.shutdown) {
      void plugin.shutdown();
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
