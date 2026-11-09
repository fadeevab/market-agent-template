import { defineChannel, POST } from "eve/channels";
import { createMarketClient } from "./client.js";
import { marketBaseUrl, marketToken, webhookSecret } from "./env.js";
import { emptyTurn, turnOutcome, type TurnAction, type TurnState } from "./outcome.js";
import {
  deliveryFor,
  isMessageTool,
  isQuoteAnswerTool,
  isSubmitTool,
  parseEvent,
  quoteJobId,
  quoteRequestFor,
  refundedAssignment,
} from "./protocol.js";
import { quoteAction, type QuoteAction } from "./quote.js";
import { verifySignature } from "./signature.js";

interface MarketChannelState {
  assignmentId: string;
  /** Set on a quote request's session, which has no assignment. */
  quoteJobId: string;
  quoteFloor: string | null;
  turn: TurnState;
}

const MARKET_AUTH = { authenticator: "market", principalType: "service", principalId: "market", attributes: {} };
const FAILED_DETAIL = "The agent could not produce a result. You have been refunded.";

/** Builds the channel that turns market hires and customer messages into turns of one session per assignment. */
export function marketChannel() {
  return defineChannel<MarketChannelState, { state: MarketChannelState }>({
    // A customer message waits for the running job turn instead of steering it.
    turnPolicy: "queue",
    state: { assignmentId: "", quoteJobId: "", quoteFloor: null, turn: emptyTurn() },
    context: (state) => ({ state }),
    fetchFile: async (url) => {
      if (!url.startsWith(`${marketBaseUrl()}/`)) return null;
      const res = await fetch(url, { headers: { authorization: `Bearer ${marketToken()}` } });
      if (!res.ok) throw new Error(`market file answered ${res.status}`);
      return { bytes: Buffer.from(await res.arrayBuffer()) };
    },
    routes: [
      POST("/market/webhook", async (request, { from, resolveSession }) => {
        let secret: string;
        try {
          secret = webhookSecret();
        } catch (err) {
          // The market's test ping shows this body to the builder, so it names the missing variable.
          return Response.json({ error: errorText(err) }, { status: 500 });
        }
        const rawBody = new Uint8Array(await request.arrayBuffer());
        const verified = verifySignature({
          secret,
          rawBody,
          timestamp: request.headers.get("x-market-timestamp"),
          signature: request.headers.get("x-market-signature"),
          nowSeconds: Math.floor(Date.now() / 1000),
        });
        if (!verified) return Response.json({ error: "invalid signature" }, { status: 401 });
        const event = parseEvent(rawBody);
        if (!event) return Response.json({ error: "invalid JSON" }, { status: 400 });
        // A cancelled hire stops its session, so a long job does not keep working for nobody.
        const refunded = refundedAssignment(event);
        if (refunded) {
          if (await resolveSession(refunded)) {
            await from(refunded).cancel();
            await from(refunded).reset({ reason: "The market cancelled this assignment." });
          }
          return Response.json({ ok: true });
        }
        const jobId = quoteJobId(event);
        if (jobId) {
          const floor = await quoteFloor(jobId);
          const quote = quoteRequestFor(event, floor, marketBaseUrl());
          // A redelivered request must not price the task twice.
          if (!quote || (await resolveSession(quote.sessionId))) return Response.json({ ok: true });
          await from(quote.sessionId).send(quote.content, {
            auth: MARKET_AUTH,
            state: { assignmentId: "", quoteJobId: quote.jobId, quoteFloor: floor, turn: emptyTurn() },
          });
          return Response.json({ ok: true });
        }
        const delivery = deliveryFor(event, marketBaseUrl());
        if (!delivery) return Response.json({ ok: true });
        // A redelivered hire must not restart the job its session already holds.
        if (delivery.kind === "hire" && (await resolveSession(delivery.assignmentId))) {
          return Response.json({ ok: true });
        }
        await from(delivery.assignmentId).send(delivery.content, {
          auth: MARKET_AUTH,
          state: { assignmentId: delivery.assignmentId, quoteJobId: "", quoteFloor: null, turn: emptyTurn() },
        });
        return Response.json({ ok: true });
      }),
    ],
    events: {
      "action.result"(data, channel) {
        const result = data.result;
        if (result.kind !== "tool-result" || data.status !== "completed" || result.isError) return;
        if (isSubmitTool(result.toolName) || isQuoteAnswerTool(result.toolName)) {
          channel.state.turn = { ...channel.state.turn, submitted: true };
        }
        if (isMessageTool(result.toolName)) channel.state.turn = { ...channel.state.turn, messaged: true };
      },
      "message.completed"(data, channel) {
        if (data.finishReason !== "tool-calls") channel.state.turn = { ...channel.state.turn, reply: data.message };
      },
      async "turn.completed"(_event, channel) {
        await settle(channel.state, false);
      },
      async "turn.failed"(_event, channel) {
        await settle(channel.state, true);
      },
    },
  });
}

async function settle(state: MarketChannelState, failed: boolean): Promise<void> {
  const turn = state.turn;
  state.turn = emptyTurn();
  if (state.quoteJobId) {
    await answerQuote(state.quoteJobId, quoteAction(turn, { failed, floor: state.quoteFloor }));
    return;
  }
  const client = createMarketClient(marketBaseUrl(), marketToken());
  let action: TurnAction;
  try {
    action = turnOutcome(turn, { owesDeliverable: await client.owesDeliverable(state.assignmentId), failed });
  } catch (err) {
    console.error(`market status check for ${state.assignmentId} failed: ${errorText(err)}`);
    return;
  }
  if (action.type === "none") return;
  try {
    if (action.type === "submit") await client.submit(state.assignmentId, action.markdown);
    if (action.type === "message") await client.sendMessage(state.assignmentId, action.body);
    if (action.type === "decline") await client.decline(state.assignmentId, FAILED_DETAIL);
  } catch (err) {
    console.error(`market ${action.type} for ${state.assignmentId} failed: ${errorText(err)}`);
  }
}

async function answerQuote(jobId: string, action: QuoteAction): Promise<void> {
  if (action.type === "none") return;
  const client = createMarketClient(marketBaseUrl(), marketToken());
  try {
    if (action.type === "quote") {
      await client.placeQuote(jobId, { amount: action.amount, slaSeconds: action.slaSeconds, proposal: action.proposal });
    }
    if (action.type === "decline") await client.declineQuote(jobId, action.reason);
  } catch (err) {
    console.error(`market ${action.type} for quote request ${jobId} failed: ${errorText(err)}`);
  }
}

/** Returns null when the lookup fails, so the agent still answers and the market enforces the floor. */
async function quoteFloor(jobId: string): Promise<string | null> {
  try {
    return await createMarketClient(marketBaseUrl(), marketToken()).quoteFloor(jobId);
  } catch (err) {
    console.error(`market from price for quote request ${jobId} failed: ${errorText(err)}`);
    return null;
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
