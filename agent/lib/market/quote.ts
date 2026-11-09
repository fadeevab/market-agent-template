import { z } from "zod";
import type { TurnState } from "./outcome.js";

const MIN_DELIVERY_MINUTES = 10;
const MAX_DELIVERY_MINUTES = 30 * 24 * 60;
const MAX_NOTE_CHARS = 2000;
const MAX_REASON_CHARS = 500;
export const UNPRICED_REASON = "The agent could not price this request.";

export type QuoteAction =
  | { type: "none" }
  | { type: "quote"; amount: string; slaSeconds: number; proposal: string }
  | { type: "decline"; reason: string };

const answerSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("quote"),
    price: z.union([z.number(), z.string()]),
    delivery_minutes: z.number(),
    note: z.string(),
  }),
  z.object({ decision: z.literal("decline"), reason: z.string() }),
]);

/**
 * Decides how the market gets the agent's answer when a quote turn ends.
 * A turn that already quoted or declined through the market's tools owes nothing.
 * A failed turn or an answer that does not parse declines, so the buyer is not left waiting.
 */
export function quoteAction(turn: TurnState, ending: { failed: boolean; floor: string | null }): QuoteAction {
  if (turn.submitted) return { type: "none" };
  const answer = ending.failed ? null : parseAnswer(turn.reply);
  if (!answer) return { type: "decline", reason: UNPRICED_REASON };
  if (answer.decision === "decline") {
    return { type: "decline", reason: answer.reason.trim().slice(0, MAX_REASON_CHARS) || UNPRICED_REASON };
  }
  const price = Number(answer.price);
  const note = answer.note.trim().slice(0, MAX_NOTE_CHARS);
  if (!Number.isFinite(price) || price <= 0 || !note) return { type: "decline", reason: UNPRICED_REASON };
  const floor = Number(ending.floor);
  const minutes = Math.min(MAX_DELIVERY_MINUTES, Math.max(MIN_DELIVERY_MINUTES, Math.round(answer.delivery_minutes)));
  return {
    type: "quote",
    // The market refuses a quote under the plan's from price, so a lower one is raised to it.
    amount: (Number.isFinite(floor) ? Math.max(price, floor) : price).toFixed(2),
    slaSeconds: minutes * 60,
    proposal: note,
  };
}

/** Reads the last JSON object in the reply, fenced or bare. */
function parseAnswer(reply: string): z.infer<typeof answerSchema> | null {
  const fenced = [...reply.matchAll(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g)].map((m) => m[1]);
  const candidates = fenced.length > 0 ? fenced : [reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1)];
  for (const candidate of candidates.reverse()) {
    try {
      const parsed = answerSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {
      continue;
    }
  }
  return null;
}
