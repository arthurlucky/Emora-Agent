/**
 * provider/factory.js
 *
 * Factory terpadu ChatOpenAI — hilangkan divergensi 10 provider.
 * Semua provider OpenAI-compatible lewat sini (groq/gemini/openrouter/nvidia/
 * openai/deepseek/huggingface/custom/ollama-http). Anthropic tetap modul sendiri.
 */
import { ChatOpenAI } from "@langchain/openai";
import { getCapabilities, shouldUseParallel } from "../core/capabilities.js";

function numEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function buildChatOpenAI({
  provider = "custom",
  apiKey = "",
  model = "",
  baseURL = "",
  tools = [],
  extraHeaders = {},
} = {}) {
  if (!model) throw new Error(`[factory:${provider}] model kosong. Set MODEL_NAME dulu.`);
  const cap = getCapabilities(provider);
  const maxTokens = numEnv("MODEL_MAX_TOKENS", cap.defaultMaxTokens);
  const temperature = Number.isFinite(Number(process.env.MODEL_TEMPERATURE))
    ? Number(process.env.MODEL_TEMPERATURE) : 0.2;
  const streaming = process.env.MODEL_STREAMING === "true" ? true
    : process.env.MODEL_STREAMING === "false" ? false
    : cap.streaming;
  const parallel = shouldUseParallel(provider);

  const configuration = {};
  if (baseURL) configuration.baseURL = baseURL;
  const defaultHeaders = { ...extraHeaders };
  if (Object.keys(defaultHeaders).length) configuration.defaultHeaders = defaultHeaders;

  const llm = new ChatOpenAI({
    apiKey: apiKey || "no-key",
    model,
    configuration,
    temperature,
    maxTokens,
    streaming,
    ...(parallel ? {} : { modelKwargs: { parallel_tool_calls: false } }),
  });
  return tools.length ? llm.bindTools(tools, { toolChoice: "auto" }) : llm;
}
