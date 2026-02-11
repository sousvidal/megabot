import type { PluginRegistry } from "./plugin-registry";
import type { LLMPlugin, ModelDefinition, ModelTier } from "~/lib/types";

export interface RouteResult {
  plugin: LLMPlugin;
  model: ModelDefinition;
}

export class ModelRouter {
  constructor(private pluginRegistry: PluginRegistry) {}

  /**
   * Route to the best available LLM plugin + model based on criteria.
   *
   * Priority:
   * 1. Specific model ID (e.g. "anthropic:claude-sonnet-4-5-20250929")
   * 2. Tier-based selection (fast/standard/powerful)
   * 3. Default: first available standard-tier model
   */
  route(params?: { tier?: ModelTier; modelId?: string }): RouteResult {
    const llmPlugins = this.pluginRegistry.getLLMPlugins();

    if (llmPlugins.length === 0) {
      throw new Error(
        "No LLM plugins registered. Please configure at least one LLM provider (e.g. set ANTHROPIC_API_KEY)."
      );
    }

    // 1. Route by specific model ID ("provider:model")
    if (params?.modelId) {
      const [providerId, modelId] = params.modelId.includes(":")
        ? params.modelId.split(":", 2)
        : [undefined, params.modelId];

      for (const plugin of llmPlugins) {
        if (providerId && plugin.id !== providerId) continue;
        const model = plugin.models.find((m) => m.id === modelId);
        if (model) {
          return { plugin, model };
        }
      }
      throw new Error(`Model "${params.modelId}" not found in any registered LLM plugin`);
    }

    // 2. Route by tier
    const targetTier = params?.tier ?? "standard";
    for (const plugin of llmPlugins) {
      const model = plugin.models.find((m) => m.tier === targetTier);
      if (model) {
        return { plugin, model };
      }
    }

    // 3. Fallback: first model from first plugin
    const fallbackPlugin = llmPlugins[0]!;
    const fallbackModel = fallbackPlugin.models[0];
    if (!fallbackModel) {
      throw new Error(`LLM plugin "${fallbackPlugin.id}" has no models registered`);
    }

    return { plugin: fallbackPlugin, model: fallbackModel };
  }
}
