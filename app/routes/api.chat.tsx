import type { Route } from "./+types/api.chat";
import { getServer } from "~/lib/server/init";
import { ChatHandler } from "~/lib/core/chat-handler";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await request.json();
  const { conversationId, message } = body as {
    conversationId?: string;
    message?: string;
  };

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return Response.json({ error: "Message is required" }, { status: 400 });
  }

  const server = getServer();

  // Check if any LLM plugin is available
  if (server.pluginRegistry.getLLMPlugins().length === 0) {
    return Response.json(
      {
        error:
          "No LLM provider configured. Set ANTHROPIC_API_KEY in your .env file.",
      },
      { status: 503 }
    );
  }

  const chatHandler = new ChatHandler(
    server.db,
    server.modelRouter,
    server.eventBus,
    server.toolRegistry
  );

  try {
    const { conversationId: convId, stream } = await chatHandler.handle({
      conversationId,
      message: message.trim(),
    });

    // Create a ReadableStream from the async generator
    const readable = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        // Send the conversation ID as the first event
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "meta", conversationId: convId })}\n\n`
          )
        );

        try {
          for await (const chunk of stream) {
            const data = JSON.stringify(chunk);
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
        } catch (err) {
          const errorMsg =
            err instanceof Error ? err.message : "Stream error";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", error: errorMsg })}\n\n`
            )
          );
        }

        controller.enqueue(
          encoder.encode(`data: [DONE]\n\n`)
        );
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Internal error";
    return Response.json({ error: errorMsg }, { status: 500 });
  }
}
