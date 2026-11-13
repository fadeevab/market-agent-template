const PAGE_SIZE = 100;

export interface MarketClient {
  owesDeliverable(assignmentId: string): Promise<boolean>;
  submit(assignmentId: string, markdown: string): Promise<void>;
  sendMessage(assignmentId: string, body: string): Promise<void>;
  decline(assignmentId: string, detail: string): Promise<void>;
  /** Returns null when the plan is no longer live, since only its owner can then read it. */
  quoteFloor(jobId: string): Promise<string | null>;
  placeQuote(jobId: string, quote: { amount: string; slaSeconds: number; proposal: string }): Promise<void>;
  declineQuote(jobId: string, reason: string): Promise<void>;
}

export class MarketError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Returns true when the market refused the call itself, so the same call fails again. */
export function isRefusal(err: unknown): boolean {
  return err instanceof MarketError && err.status >= 400 && err.status < 500;
}

/** Builds a market REST client that authenticates every call with the agent token. */
export function createMarketClient(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch): MarketClient {
  const request = async (method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> => {
    const res = await fetchImpl(new URL(path, baseUrl), {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new MarketError(res.status, `market ${method} ${path} answered ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
  return {
    owesDeliverable: async (assignmentId) => {
      // The default view lists only in-progress assignments, which are the ones still owed a deliverable.
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = (await request("GET", `/v1/agents/me/assignments?limit=${PAGE_SIZE}&offset=${offset}`)) as {
          assignments?: Array<{ assignment?: { assignmentId?: string } }>;
        } | null;
        const rows = page?.assignments ?? [];
        if (rows.some((row) => row.assignment?.assignmentId === assignmentId)) return true;
        if (rows.length < PAGE_SIZE) return false;
      }
    },
    submit: async (assignmentId, markdown) => {
      await request("POST", `/v1/assignments/${assignmentId}/submit`, { deliverableMarkdown: markdown });
    },
    sendMessage: async (assignmentId, body) => {
      await request("POST", `/v1/assignments/${assignmentId}/messages`, { body: body.trim().slice(0, 4000) });
    },
    decline: async (assignmentId, detail) => {
      await request("POST", `/v1/assignments/${assignmentId}/decline`, { reason: "failed", detail: detail.slice(0, 1000) });
    },
    quoteFloor: async (jobId) => {
      const job = (await request("GET", `/v1/jobs/${jobId}`)) as { invitedAgentId?: string; pricingPlanId?: string } | null;
      if (!job?.invitedAgentId || !job.pricingPlanId) return null;
      const plans = (await request("GET", `/v1/agents/${job.invitedAgentId}/pricing-plans`)) as Array<{
        pricing_plan_id?: string;
        price_amount?: string;
      }> | null;
      return plans?.find((plan) => plan.pricing_plan_id === job.pricingPlanId)?.price_amount ?? null;
    },
    placeQuote: async (jobId, quote) => {
      await request("POST", `/v1/jobs/${jobId}/bids`, quote);
    },
    declineQuote: async (jobId, reason) => {
      await request("POST", `/v1/jobs/${jobId}/decline`, { reason });
    },
  };
}
