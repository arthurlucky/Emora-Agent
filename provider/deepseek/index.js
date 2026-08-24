// provider/deepseek/index.js
//
// DeepSeek via API RESMI — api.deepseek.com, OpenAI-compatible.
// Tool calling penuh, stabil, harga sangat murah.
// Key: https://platform.deepseek.com/api_keys → DEEPSEEK_API_KEY di .env
//
// (Dulu ada mode scrape aichat.org — dihapus: rapuh, abu-abu ToS,
//  dan tanpa tool calling sehingga agent tidak berfungsi.)

import { ChatOpenAI } from "@langchain/openai";

export const PROVIDER_ID    = "deepseek";
export const PROVIDER_LABEL = "DeepSeek";
export const PROVIDER_TIER  = "paid"; // sangat murah, tapi bukan gratis
export const KEY_URL        = "https://platform.deepseek.com/api_keys";
export const BASE_URL       = "https://api.deepseek.com/v1";

export const MODELS = [
  {
    id:      "deepseek-chat",
    label:   "DeepSeek V3 (API resmi)  — tool calling OK, sangat murah",
    context: 65536,
    tier:    "paid",
  },
  {
    id:      "deepseek-reasoner",
    label:   "DeepSeek R1 (API resmi) — reasoning kuat, tanpa tool calling",
    context: 65536,
    tier:    "paid",
  },
];

export const DEFAULT_MODEL = "deepseek-chat";

/**
 * @param {{ apiKey?: string, model?: string, tools?: any[] }} opts
 */
export function createLLM({ apiKey, model, tools = [] } = {}) {
  const chosenModel = (model || process.env.MODEL_NAME || DEFAULT_MODEL).replace(/-scrape$/, "");
  const llm = new ChatOpenAI({
    apiKey: apiKey || process.env.DEEPSEEK_API_KEY || process.env.MODEL_API,
    model: chosenModel,
    configuration: { baseURL: BASE_URL },
    temperature: 0.2,
    maxTokens: 4096,
  });
  return tools.length ? llm.bindTools(tools, { toolChoice: "auto" }) : llm;
}

export default { createLLM, MODELS, DEFAULT_MODEL };
