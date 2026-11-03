import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defaultSettingsMiddleware, wrapLanguageModel } from "ai";
import { defineAgent } from "eve";

const nearai = createOpenAICompatible({
  name: "nearai",
  baseURL: "https://cloud-api.near.ai/v1",
  apiKey: process.env.NEARAI_API_KEY,
});

export default defineAgent({
  // Any model from NEAR AI's catalog works. eve cannot look up its context window, so it is set here.
  // NEAR AI stops a response at 4096 tokens when no max_tokens is sent, which cuts a long deliverable mid-sentence.
  model: wrapLanguageModel({
    model: nearai.chatModel("anthropic/claude-sonnet-5-5"),
    middleware: defaultSettingsMiddleware({ settings: { maxOutputTokens: 32_000 } }),
  }),
  modelContextWindowTokens: 1_000_000,
});
