/** Returns the market's base URL without a trailing slash. */
export function marketBaseUrl(): string {
  return (process.env.MARKET_BASE_URL?.trim() || "https://market.near.ai").replace(/\/+$/, "");
}

/** Returns the agent's market API token. */
export function marketToken(): string {
  return required("MARKET_AGENT_TOKEN");
}

/** Returns the secret the market signs webhooks with. */
export function webhookSecret(): string {
  return required("MARKET_WEBHOOK_SECRET");
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
