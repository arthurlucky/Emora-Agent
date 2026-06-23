/**
 * provider/openai_compat.js
 *
 * Provider untuk semua endpoint yang kompatibel dengan OpenAI API:
 *   - OpenAI sendiri
 *   - Groq
 *   - NVIDIA NIM
 *   - OpenRouter
 *   - Google Gemini (via OpenAI-compat endpoint)
 *   - Ollama (via /v1)
 *
 * Semua pakai ChatOpenAI dari @langchain/openai, cukup beda BASE_URL & key.
 */

import { ChatOpenAI } from "@langchain/openai";

// Optimasi per-provider:
// Groq dan NVIDIA punya rate limit ketat → maxTokens lebih rendah
// OpenRouter → pass extra_body headers biar request ke-route benar
// Gemini via OpenAI compat → streaming kadang bermasalah, force non-stream

const PROVIDER_CONFIGS = {
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    temperature: 0.2,
    maxTokens: 4096,        // Groq ada hard limit 8192, lebih aman 4096
    // Groq TIDAK support parallel_tool_calls → harus dimatiin
    modelKwargs: { parallel_tool_calls: false },
    label: "Groq",
    tier: "free",
  },
  nvidia: {
    baseURL: "https://integrate.api.nvidia.com/v1",
    defaultModel: "meta/llama-3.1-70b-instruct",
    temperature: 0.2,
    maxTokens: 2048,
    modelKwargs: {},
    label: "NVIDIA NIM",
    tier: "free",
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "google/gemini-2.0-flash-exp:free",
    temperature: 0.2,
    maxTokens: 4096,
    // OpenRouter butuh header HTTP-Referer biar gak kena 403
    modelKwargs: {},
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/emora-agent",
      "X-Title": "EMORA Agent",
    },
    label: "OpenRouter",
    tier: "free",
  },
  openai: {
    baseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    temperature: 0.2,
    maxTokens: 4096,
    modelKwargs: {},
    label: "OpenAI",
    tier: "paid",
  },
  gemini: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    defaultModel: "gemini-2.0-flash",
    temperature: 0.2,
    maxTokens: 4096,
    modelKwargs: {},
    label: "Google Gemini",
    tier: "free",
  },
  ollama: {
    // baseURL di-build dari OLLAMA_HOST env
    defaultModel: "llama3.2:3b",
    temperature: 0.1,         // Ollama lokal → bisa lebih deterministik
    maxTokens: 4096,
    modelKwargs: {},
    label: "Ollama (Local)",
    tier: "free",
  },
};

/**
 * Buat instance ChatOpenAI yang udah di-bindTools.
 * Dipanggil dari provider/index.js, bukan langsung dari luar.
 */
export function createOpenAICompatLLM(providerKey, { apiKey, model, tools, ollamaHost } = {}) {
  const cfg = PROVIDER_CONFIGS[providerKey];
  if (!cfg) throw new Error(`[PROVIDER] Unknown openai-compat provider: ${providerKey}`);

  let baseURL = cfg.baseURL;
  if (providerKey === "ollama") {
    const host = (ollamaHost || process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/$/, "");
    baseURL = `${host}/v1`;
  }

  const llmOpts = {
    apiKey: apiKey || process.env.MODEL_API || "ollama",
    model: model || process.env.MODEL_NAME || cfg.defaultModel,
    configuration: {
      baseURL,
      defaultHeaders: cfg.defaultHeaders || {},
    },
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    modelKwargs: cfg.modelKwargs || {},
  };

  const llm = new ChatOpenAI(llmOpts);
  if (tools?.length) {
    return llm.bindTools(tools, { toolChoice: "auto" });
  }
  return llm;
}

export { PROVIDER_CONFIGS };
