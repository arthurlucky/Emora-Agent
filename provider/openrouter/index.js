/**
 * provider/openrouter/index.js
 *
 * OpenRouter — gateway ke ratusan model AI dari satu API key.
 * Ada banyak model gratis (`:free` suffix) & berbayar.
 * API key: https://openrouter.ai/keys
 *
 * Optimasi untuk EMORA agent:
 * - Header HTTP-Referer wajib ada — tanpa ini banyak model di OR nolak request.
 * - X-Title membantu identifikasi traffic di dashboard OR.
 * - Model `:free` punya rate limit lebih ketat (20 req/min) dibanding model
 *   berbayar → kalau sering timeout, switch ke model bayar atau provider lain.
 */

import { ChatOpenAI } from "@langchain/openai";

export const PROVIDER_ID    = "openrouter";
export const PROVIDER_LABEL = "OpenRouter";
export const PROVIDER_TIER  = "free";
export const BASE_URL       = "https://openrouter.ai/api/v1";
export const KEY_URL        = "https://openrouter.ai/keys";

export const MODELS = [
  // ── GRATIS ──────────────────────────────────────────────────────────────
  {
    id:      "google/gemini-2.0-flash-exp:free",
    label:   "Gemini 2.0 Flash (free)    — Recommended gratis, tool calling bagus",
    context: 1048576,
    tier:    "free",
  },
  {
    id:      "meta-llama/llama-3.3-70b-instruct:free",
    label:   "Llama 3.3 70B (free)       — Meta, kuat untuk agent",
    context: 65536,
    tier:    "free",
  },
  {
    id:      "deepseek/deepseek-r1:free",
    label:   "DeepSeek R1 (free)         — Reasoning model terbaik",
    context: 163840,
    tier:    "free",
  },
  {
    id:      "deepseek/deepseek-chat-v3-0324:free",
    label:   "DeepSeek V3 (free)         — General purpose, powerful",
    context: 65536,
    tier:    "free",
  },
  {
    id:      "mistralai/mistral-7b-instruct:free",
    label:   "Mistral 7B (free)          — Cepat, ringan",
    context: 32768,
    tier:    "free",
  },
  {
    id:      "qwen/qwen3-235b-a22b:free",
    label:   "Qwen3 235B (free)          — MoE terbesar yang gratis",
    context: 40960,
    tier:    "free",
  },
  {
    id:      "microsoft/phi-4-reasoning:free",
    label:   "Phi-4 Reasoning (free)     — Microsoft, ringan+reasoning",
    context: 16384,
    tier:    "free",
  },
  // ── BERBAYAR ─────────────────────────────────────────────────────────────
  {
    id:      "anthropic/claude-sonnet-4-5",
    label:   "Claude Sonnet 4.5          — Terbaik untuk agent [BAYAR]",
    context: 200000,
    tier:    "paid",
  },
  {
    id:      "openai/gpt-4o",
    label:   "GPT-4o                     — OpenAI flagship [BAYAR]",
    context: 128000,
    tier:    "paid",
  },
  {
    id:      "google/gemini-2.5-pro-preview",
    label:   "Gemini 2.5 Pro             — Terpintar dari Google [BAYAR]",
    context: 2097152,
    tier:    "paid",
  },
  {
    id:      "x-ai/grok-3-mini-beta",
    label:   "Grok 3 Mini                — xAI, reasoning ringan [BAYAR]",
    context: 131072,
    tier:    "paid",
  },
];

export const DEFAULT_MODEL = "google/gemini-2.0-flash-exp:free";

/**
 * Fetch daftar model LIVE dari OpenRouter API (tanpa auth), cache 24 jam
 * di .emora/or_models.json. Return [{id, name, context, free, params}].
 * Fallback: throw → caller pakai MODELS hardcoded.
 */
export async function fetchModels({ force = false } = {}) {
  const fsSync = await import("fs");
  const cacheFile = ".emora/or_models.json";

  if (!force && fsSync.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fsSync.readFileSync(cacheFile, "utf8"));
      if (Date.now() - cached.ts < 24 * 60 * 60 * 1000) return cached.models;
    } catch { /* cache rusak → refetch */ }
  }

  const res = await fetch(`${BASE_URL}/models`, {
    headers: { "HTTP-Referer": "https://github.com/arthurlucky/Emora-Agent" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`OpenRouter API ${res.status}`);

  const json = await res.json();
  const models = (json.data || []).map((m) => ({
    id: m.id,
    name: m.name || m.id,
    context: m.context_length || 0,
    // pricing.prompt dalam string USD per token; "0" = gratis.
    free: String(m.pricing?.prompt) === "0",
    params: m.id.match(/[-_](\d+(?:\.\d+)?)b\b/i)?.[1] || null, // "8b", "1.5B"
  }));

  fsSync.mkdirSync(".emora", { recursive: true });
  fsSync.writeFileSync(cacheFile, JSON.stringify({ ts: Date.now(), models }));
  return models;
}

/** Deteksi model kecil (≤1.5B atau mini/tiny) dari nama — untuk auto AGENT_LITE. */
export function isSmallModel(modelIdOrName) {
  const s = String(modelIdOrName).toLowerCase();
  if (/[-_]\d+m\b/.test(s)) return true; // 270m, 350m — jutaan param pasti kecil
  const bMatch = s.match(/[-_](\d+(?:\.\d+)?)b\b/);
  if (bMatch) return parseFloat(bMatch[1]) <= 1.5;
  return /mini|tiny|small|nano/.test(s);
}

/**
 * @param {{ apiKey?: string, model?: string, tools?: any[] }} opts
 */
export function createLLM({ apiKey, model, tools = [] } = {}) {
  const llm = new ChatOpenAI({
    apiKey: apiKey || process.env.MODEL_API || process.env.OPENROUTER_API_KEY,
    model:  model  || process.env.MODEL_NAME || DEFAULT_MODEL,
    configuration: {
      baseURL: BASE_URL,
      // KRITIS: OpenRouter reject request tanpa header ini
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/arthurlucky/Emora-Agent",
        "X-Title":      "EMORA Agent",
      },
    },
    temperature: 0.2,
    maxTokens:   4096,
  });

  return tools.length ? llm.bindTools(tools, { toolChoice: "auto" }) : llm;
}
