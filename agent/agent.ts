import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineAgent } from "eve";

const nearai = createOpenAICompatible({
  name: "nearai",
  baseURL: "https://cloud-api.near.ai/v1",
  apiKey: process.env.NEARAI_API_KEY,
});

export default defineAgent({
  // Any model from NEAR AI's catalog works. eve cannot look up its context window, so it is set here.
  model: nearai.chatModel("anthropic/claude-sonnet-5-5"),
  modelContextWindowTokens: 1_000_000,
});
