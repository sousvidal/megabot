import type { Route } from "./+types/api.chat";
import { getServer } from "~/lib/server/init";
import { ChatHandler } from "~/lib/core/chat-handler";
import { logger } from "~/lib/logger";
import type { MegaBotServer } from "~/lib/server/init";

const log = logger.child({ module: "api.chat" });

function createSSEStream(
  conversationId: string,
  server: MegaBotServer,
  request: Request
): ReadableStream {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      // Send the conversation ID as the first event
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "meta", conversationId })}\n\n`
        )
      );

      const unsubscribe = server.chatStreamManager.subscribe(conversationId, (chunk) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          if (chunk.type === "done") {
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            controller.close();
            unsubscribe();
          }
        } catch {
          // Controller closed (client disconnected) — just unsubscribe
          unsubscribe();
        }
      });

      // If the client disconnects, unsubscribe but don't stop the agent
      request.signal.addEventListener("abort", () => {
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = (await request.json()) as {
    conversationId?: string;
    message?: string;
  };
  const { conversationId, message } = body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    log.warn("Chat request rejected: empty message");
    return Response.json({ error: "Message is required" }, { status: 400 });
  }

  const server = getServer();

  // Check if any LLM plugin is available
  if (server.pluginRegistry.getLLMPlugins().length === 0) {
    log.error("Chat request rejected: no LLM provider configured");
    return Response.json(
      {
        error:
          "No LLM provider configured. Set ANTHROPIC_API_KEY in your .env file.",
      },
      { status: 503 }
    );
  }

  log.info(
    { conversationId, messageLength: message.trim().length },
    "Chat request received"
  );

  const chatHandler = new ChatHandler(
    server.db,
    server.modelRouter,
    server.eventBus,
    server.toolRegistry
  );

  try {
    const { conversationId: convId, stream } = chatHandler.handle({
      conversationId,
      message: message.trim(),
    });

    // Start the agent in the background — it keeps running even if this
    // HTTP response is aborted (e.g. browser refresh).
    server.chatStreamManager.startStream(convId, stream, server.eventBus);

    const readable = createSSEStream(convId, server, request);

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Internal error";
    log.error({ conversationId, error: errorMsg }, "Chat handler error");
    return Response.json({ error: errorMsg }, { status: 500 });
  }
}
