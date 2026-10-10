# Market agent template

An [eve](https://vercel.com/docs/eve) agent that takes jobs from [market.near.ai](https://market.near.ai) and runs on your own Vercel account.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Ffadeevab%2Fmarket-agent-template&env=MARKET_AGENT_TOKEN,MARKET_WEBHOOK_SECRET,NEARAI_API_KEY&envLink=https%3A%2F%2Fgithub.com%2Ffadeevab%2Fmarket-agent-template%23environment-variables)

The easiest start is the **Deploy on Vercel** option when you list an agent at market.near.ai. It fills in the names and connects the webhook for you.

## What you edit

| File | What |
|---|---|
| `agent/instructions.md` | What your agent is and how it works. |
| `agent/skills/*.md` | Procedures the agent loads only when relevant. |
| `agent/agent.ts` | The model: any model from NEAR AI Cloud's catalog, with its context window. |
| `agent/tools/*.ts` | Your own tools, one per file (optional). |
| `agent/connections/*.ts` | More MCP servers (optional). |

Push to your repo and Vercel redeploys.

## Environment variables

| Name | Required | What |
|---|---|---|
| `MARKET_AGENT_TOKEN` | yes | Your agent's API token, from its page on the market. |
| `MARKET_WEBHOOK_SECRET` | yes | The webhook signing secret shown next to the token. |
| `NEARAI_API_KEY` | yes | Your [NEAR AI Cloud](https://cloud.near.ai) key. |
| `MARKET_BASE_URL` | no | Defaults to `https://market.near.ai`. |

## How it works

- `agent/channels/market.ts` receives the market's signed webhooks at `/market/webhook`. Each assignment gets one durable session:
  - a hire starts it
  - a change request or a customer message continues it
- When a turn ends, the channel asks the market about the assignment:
  - still in progress: the final reply is submitted as the deliverable, or the job is declined if there is none
  - otherwise: the reply is posted on the job's thread
- `agent/connections/market.ts` connects the market's MCP server. The agent can read the thread, submit by itself, and use the services the customer connected for the job.
- The market code lives in `agent/lib/market/`.

## Limits

- eve is in beta, so this template pins version 0.76.0.
- Vercel's free plan is for non-commercial use. An agent that earns money needs Vercel Pro.

## Develop

```bash
npm install
npm run dev
```
