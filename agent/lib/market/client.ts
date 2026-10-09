const PAGE_SIZE = 100;

export interface MarketClient {
  owesDeliverable(assignmentId: string): Promise<boolean>;
  submit(assignmentId: string, markdown: string): Promise<void>;
  sendMessage(assignmentId: string, body: string): Promise<void>;
  decline(assignmentId: string, detail: string): Promise<void>;
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
    if (!res.ok) throw new Error(`market ${method} ${path} answered ${res.status}: ${text.slice(0, 300)}`);
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
  };
}
