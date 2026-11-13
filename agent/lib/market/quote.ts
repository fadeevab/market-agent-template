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
    delivery_minutes: z.union([z.number(), z.string()]),
    note: z.string(),
  }),
  z.object({ decision: z.literal("decline"), reason: z.string() }),
]);

// A decimal comma does not match, because "35,50" read as 3550 is a wrong price.
const PRICE = /^[^\d-]*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\D*$/;

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
  const price = priceIn(answer.price);
  const delivery = minutesIn(answer.delivery_minutes);
  const note = answer.note.trim().slice(0, MAX_NOTE_CHARS);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(delivery) || !note) {
    return { type: "decline", reason: UNPRICED_REASON };
  }
  const floor = Number(ending.floor);
  const minutes = Math.min(MAX_DELIVERY_MINUTES, Math.max(MIN_DELIVERY_MINUTES, Math.round(delivery)));
  return {
    type: "quote",
    // The market refuses a quote under the plan's from price, so a lower one is raised to it.
    amount: upToCents(Number.isFinite(floor) ? Math.max(price, floor) : price),
    slaSeconds: minutes * 60,
    proposal: note,
  };
}

/** Reads a price that the model wrote with a currency sign, thousands commas or a token name. */
function priceIn(value: number | string): number {
  if (typeof value === "number") return value;
  const match = PRICE.exec(value.trim());
  return match ? Number(match[1].replace(/,/g, "") + (match[2] ?? "")) : Number.NaN;
}

/** Reads a plain count of minutes, and no unit, because "4 hours" read as 4 is a wrong time. */
function minutesIn(value: number | string): number {
  if (typeof value === "number") return value;
  return value.trim() ? Number(value) : Number.NaN;
}

/** Rounds up, because an amount rounded to the nearest cent can be below the from price. */
function upToCents(amount: number): string {
  return (Math.ceil(amount * 100 - 1e-9) / 100).toFixed(2);
}

/** Reads the last JSON object in the reply that is an answer, fenced or bare. */
function parseAnswer(reply: string): z.infer<typeof answerSchema> | null {
  const fenced = [...reply.matchAll(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g)].map((m) => m[1]).reverse();
  for (const candidate of [...fenced, ...bareObjects(reply)]) {
    try {
      const parsed = answerSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {
      continue;
    }
  }
  return null;
}

/** Returns each text from a `{` to the last `}`, the latest `{` first. */
function bareObjects(reply: string): string[] {
  const end = reply.lastIndexOf("}");
  const starts = [...reply.matchAll(/\{/g)].map((m) => m.index).filter((start) => start < end);
  return starts.reverse().map((start) => reply.slice(start, end + 1));
}
