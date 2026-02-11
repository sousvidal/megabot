import type { Tool } from "~/lib/types";

const DEFAULT_MAX_LENGTH = 50_000;
const FETCH_TIMEOUT_MS = 15_000;

export const webFetchTool: Tool = {
  name: "web_fetch",
  description:
    "Fetch the content of a URL and return the response body as text. Useful for reading web pages, public APIs, JSON endpoints, or downloading text content. Returns the raw response body truncated to a maximum length.",
  keywords: ["url", "website", "http", "download", "api", "webpage", "internet", "browse"],
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch.",
      },
      maxLength: {
        type: "number",
        description: `Maximum number of characters to return. Defaults to ${DEFAULT_MAX_LENGTH}.`,
      },
    },
    required: ["url"],
  },
  permissions: "read",

  async execute(params) {
    const { url, maxLength = DEFAULT_MAX_LENGTH } = params as {
      url: string;
      maxLength?: number;
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "MegaBot/1.0",
          Accept: "text/html,application/json,text/plain,*/*",
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status} ${response.statusText}`,
        };
      }

      let body = await response.text();
      const truncated = body.length > maxLength;
      if (truncated) {
        body = body.slice(0, maxLength);
      }

      const contentType = response.headers.get("content-type") ?? "unknown";

      return {
        success: true,
        data: `Content-Type: ${contentType}\n${truncated ? `[Truncated to ${maxLength} chars]\n` : ""}---\n${body}`,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown fetch error";
      return { success: false, error: message };
    }
  },
};
