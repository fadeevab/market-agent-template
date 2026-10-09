export const MAX_DELIVERABLE_BYTES = 250_000;
const MAX_MESSAGE_CHARS = 4000;
const TRUNCATED_NOTE = "\n\n[Truncated: the result exceeded the market's size limit.]";

export interface TurnState {
  submitted: boolean;
  messaged: boolean;
  reply: string;
}

export type TurnAction =
  | { type: "none" }
  | { type: "submit"; markdown: string }
  | { type: "message"; body: string }
  | { type: "decline" };

/** Returns the state of a turn that has not started. */
export function emptyTurn(): TurnState {
  return { submitted: false, messaged: false, reply: "" };
}

/**
 * Decides what the market gets when a turn ends.
 * An assignment still in progress owes a deliverable, so its turn submits the final reply or declines.
 * Any other turn answered a customer message, so its final reply goes to the thread.
 */
export function turnOutcome(turn: TurnState, ending: { owesDeliverable: boolean; failed: boolean }): TurnAction {
  const reply = turn.reply.trim();
  if (turn.submitted) return { type: "none" };
  if (ending.owesDeliverable) {
    if (!ending.failed && reply) return { type: "submit", markdown: capBytes(reply, MAX_DELIVERABLE_BYTES) };
    return { type: "decline" };
  }
  if (!turn.messaged && !ending.failed && reply) return { type: "message", body: reply.slice(0, MAX_MESSAGE_CHARS) };
  return { type: "none" };
}

/** Cuts text to a UTF-8 byte budget and appends a note when it had to cut. */
export function capBytes(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return text;
  const room = maxBytes - encoder.encode(TRUNCATED_NOTE).length;
  // A cut inside a multi-byte character decodes to U+FFFD, which is dropped.
  const head = new TextDecoder().decode(bytes.slice(0, room)).replace(/�+$/, "");
  return head + TRUNCATED_NOTE;
}
