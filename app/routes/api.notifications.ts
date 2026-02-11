import { getServer } from "~/lib/server/init";
import type { Route } from "./+types/api.notifications";
import { logger } from "~/lib/logger";

const log = logger.child({ module: "api.notifications" });

/**
 * SSE endpoint that pushes real-time notifications to the frontend.
 * Currently pushes agent.completed and agent.error events.
 * This is the foundation for the full Stream feature.
 */
export function loader({ request }: Route.LoaderArgs) {
  const server = getServer();
  const encoder = new TextEncoder();

  log.debug("SSE notification stream connected");

  const stream = new ReadableStream({
    start(controller) {
      // Send a heartbeat immediately so the client knows the connection is alive
      controller.enqueue(encoder.encode(": heartbeat\n\n"));

      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 30_000);

      const unsubscribe = server.eventBus.onAny((event) => {
        // Only push events the frontend cares about right now
        if (
          event.type !== "agent.completed" &&
          event.type !== "agent.error" &&
          event.type !== "agent.spawned" &&
          event.type !== "chat.completed"
        ) {
          return;
        }

        try {
          const payload = JSON.stringify({
            type: event.type,
            conversationId: event.conversationId,
            agentId: event.agentId,
            data: event.data,
            timestamp: event.timestamp.toISOString(),
          });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch {
          // Client disconnected
        }
      });

      // Clean up on disconnect
      request.signal.addEventListener("abort", () => {
        log.debug("SSE notification stream disconnected");
        clearInterval(heartbeatInterval);
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
