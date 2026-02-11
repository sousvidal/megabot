import type { LLMMessage } from "~/lib/types";

/** Safely parse tool call arguments. Returns {} for empty/invalid input. */
export function safeParseArgs(raw: string): Record<string, unknown> {
  if (!raw || raw.trim().length === 0) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Truncate conversation history to fit within a character budget.
 * Keeps the most recent messages, always preserving at least the last user message.
 * Ensures messages still alternate user/assistant (doesn't cut mid-pair).
 */
export function truncateHistory(
  msgs: LLMMessage[],
  maxChars: number
): LLMMessage[] {
  const charLen = (m: LLMMessage): number => {
    if (typeof m.content === "string") return m.content.length;
    return JSON.stringify(m.content).length;
  };

  let totalChars = 0;
  for (const m of msgs) {
    totalChars += charLen(m);
  }

  if (totalChars <= maxChars) {
    return msgs;
  }

  // Work backwards, keeping messages until we hit the budget
  const kept: LLMMessage[] = [];
  let chars = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    if (!msg) continue;
    const len = charLen(msg);
    if (chars + len > maxChars && kept.length > 0) {
      break;
    }
    chars += len;
    kept.unshift(msg);
  }

  // Ensure the first message is a user message (Anthropic requires this)
  const firstMsg = kept[0];
  while (kept.length > 0 && firstMsg && firstMsg.role !== "user") {
    kept.shift();
  }

  return kept;
}
