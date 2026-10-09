import { createHmac, timingSafeEqual } from "node:crypto";

export const MAX_SKEW_SECONDS = 300;

/** Returns true when the market's signature matches the raw body and the timestamp is fresh. */
export function verifySignature(params: {
  secret: string;
  rawBody: Uint8Array;
  timestamp: string | null;
  signature: string | null;
  nowSeconds: number;
}): boolean {
  const { secret, rawBody, timestamp, signature, nowSeconds } = params;
  if (!timestamp || !signature?.startsWith("sha256=")) return false;
  const sentAt = Number(timestamp);
  if (!Number.isInteger(sentAt) || Math.abs(nowSeconds - sentAt) > MAX_SKEW_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest();
  const provided = Buffer.from(signature.slice("sha256=".length), "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
