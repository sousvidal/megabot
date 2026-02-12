import { getServer } from "~/lib/server/init";
import type { Route } from "./+types/api.chat.$id.stream";
import { logger } from "~/lib/logger";

const log = logger.child({ module: "api.chat.stream" });

/**
 * GET /api/chat/:id/stream
 *
 * SSE endpoint that reconnects to an active (or recently completed) chat
 * stream. Replays only the current in-progress turn — completed turns are
 * already in the DB and loaded by the route loader.
 */
export function loader({ params, request }: Route.LoaderArgs) {
  const server = getServer();
  const conversationId = params.id;

  if (!server.chatStreamManager.isActive(conversationId)) {
    return new Response(null, { status: 204 });
  }

  log.info({ conversationId }, "SSE stream reconnect");

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "meta", conversationId })}\n\n`
        )
      );

      const unsubscribe =
        server.chatStreamManager.subscribeFromCurrentTurn(
          conversationId,
          (chunk) => {
            try {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
              );
              if (chunk.type === "done") {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
                unsubscribe();
              }
            } catch {
              // Controller closed (client disconnected) — just unsubscribe
              unsubscribe();
            }
          }
        );

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

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
