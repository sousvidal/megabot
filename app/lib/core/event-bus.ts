import { nanoid } from "nanoid";
import type { BotEvent, BotEventType, EventLevel } from "~/lib/types";

type EventHandler = (event: BotEvent) => void;

export class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private globalHandlers = new Set<EventHandler>();

  /**
   * Subscribe to a specific event type.
   * Returns an unsubscribe function.
   */
  on(type: BotEventType, handler: EventHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  /**
   * Subscribe to all events.
   * Returns an unsubscribe function.
   */
  onAny(handler: EventHandler): () => void {
    this.globalHandlers.add(handler);
    return () => this.globalHandlers.delete(handler);
  }

  /**
   * Emit an event. Notifies all matching subscribers.
   */
  emit(
    type: BotEventType,
    source: string,
    data: Record<string, unknown> = {},
    options?: {
      level?: EventLevel;
      agentId?: string;
      conversationId?: string;
    }
  ): BotEvent {
    const event: BotEvent = {
      id: nanoid(),
      timestamp: new Date(),
      type,
      source,
      data,
      level: options?.level ?? "info",
      agentId: options?.agentId,
      conversationId: options?.conversationId,
    };

    // Notify type-specific handlers
    const typeHandlers = this.handlers.get(type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          handler(event);
        } catch {
          // Don't let handler errors break the bus
        }
      }
    }

    // Notify global handlers
    for (const handler of this.globalHandlers) {
      try {
        handler(event);
      } catch {
        // Don't let handler errors break the bus
      }
    }

    return event;
  }
}
