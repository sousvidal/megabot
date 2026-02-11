import type { Tool, ToolPlugin } from "~/lib/types";
import type { Logger } from "~/lib/logger";

const FETCH_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Brave Search API
// ---------------------------------------------------------------------------

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function searchBrave(
  query: string,
  maxResults: number,
  apiKey: string
): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });

  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`Brave Search API returned HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
      }>;
    };
  };

  return (data.web?.results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title ?? "(no title)",
    url: r.url ?? "",
    snippet: stripHtml(r.description ?? ""),
  }));
}

// ---------------------------------------------------------------------------
// SearXNG (self-hosted meta search)
// ---------------------------------------------------------------------------

async function searchSearXNG(
  query: string,
  maxResults: number,
  baseUrl: string
): Promise<SearchResult[]> {
  const url = `${baseUrl.replace(/\/$/, "")}/search?q=${encodeURIComponent(query)}&format=json&categories=general`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      Accept: "application/json",
      "User-Agent": "MegaBot/1.0",
    },
  });

  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`SearXNG returned HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
    }>;
  };

  return (data.results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title ?? "(no title)",
    url: r.url ?? "",
    snippet: stripHtml(r.content ?? ""),
  }));
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const webSearchTool: Tool = {
  name: "web_search",
  description:
    "Search the web and return a list of results with titles, URLs, and snippets. " +
    "Use this to find current information, research topics, look up documentation, " +
    "or answer questions that require up-to-date knowledge. " +
    "Requires a search provider to be configured (Brave Search API or SearXNG).",
  keywords: [
    "search",
    "web",
    "google",
    "internet",
    "find",
    "lookup",
    "query",
    "research",
    "browse",
    "information",
  ],
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query.",
      },
      maxResults: {
        type: "number",
        description: "Maximum number of results to return. Defaults to 10.",
      },
    },
    required: ["query"],
  },
  permissions: "read",

  async execute(params) {
    const { query, maxResults = 10 } = params as {
      query: string;
      maxResults?: number;
    };

    if (!query.trim()) {
      return { success: false, error: "Search query cannot be empty." };
    }

    const braveKey = process.env.BRAVE_SEARCH_API_KEY;
    const searxngUrl = process.env.SEARXNG_URL;

    if (!braveKey && !searxngUrl) {
      return {
        success: false,
        error:
          "No search provider configured. Set BRAVE_SEARCH_API_KEY (free at https://brave.com/search/api/) " +
          "or SEARXNG_URL (self-hosted instance) in your .env file.",
      };
    }

    try {
      const results = braveKey
        ? await searchBrave(query, maxResults, braveKey)
        : await searchSearXNG(query, maxResults, searxngUrl!);

      if (results.length === 0) {
        return {
          success: true,
          data: `No results found for "${query}".`,
        };
      }

      const formatted = results.map(
        (r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`
      );

      return {
        success: true,
        data: `Found ${results.length} result(s) for "${query}":\n\n${formatted.join("\n\n")}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed";
      return { success: false, error: message };
    }
  },
};

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

export function createWebSearchPlugin(logger: Logger): ToolPlugin {
  const log = logger.child({ plugin: "web-search" });

  return {
    id: "web-search",
    name: "Web Search",
    type: "tool",
    description: "Search the web for information (via Brave Search API or SearXNG)",
    tools: [webSearchTool],
    afterToolCall: (_toolName, params, _context, result) => {
      const { query } = params as { query?: string };
      if (result.success) {
        log.debug({ query }, "Web search completed");
      } else {
        log.warn({ query, error: result.error }, "Web search failed");
      }
    },
  };
}
