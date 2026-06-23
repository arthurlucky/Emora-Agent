/**
 * provider/index.js
 *
 * Registry provider terpusat. SATU-satunya tempat yang perlu diubah kalau
 * mau nambah provider baru — main.js, gateway, dan webui semua pakai ini.
 *
 * Cara pakai:
 *   import { createLLM, getProviderMeta } from "../provider/index.js";
 *   const llm = await createLLM(tools);   // baca dari .env secara otomatis
 */

import { createOpenAICompatLLM, PROVIDER_CONFIGS } from "./openai_compat.js";
import { createAnthropicLLM } from "./anthropic.js";
import { createHuggingFaceLLM } from "./huggingface.js";

// ─── Registry semua provider yang dikenali ────────────────────────────────────
export const PROVIDERS = {
  // OpenAI-compatible (pakai @langchain/openai — sudah terinstall)
  groq:        { label: "Groq",             tier: "free",   type: "openai-compat" },
  nvidia:      { label: "NVIDIA NIM",       tier: "free",   type: "openai-compat" },
  openrouter:  { label: "OpenRouter",       tier: "free",   type: "openai-compat" },
  openai:      { label: "OpenAI",           tier: "paid",   type: "openai-compat" },
  gemini:      { label: "Google Gemini",    tier: "free",   type: "openai-compat" },
  ollama:      { label: "Ollama (Local)",   tier: "free",   type: "openai-compat" },

  // Native adapters
  anthropic:   { label: "Anthropic Claude", tier: "paid",   type: "anthropic",    installHint: "npm install @langchain/anthropic" },
  huggingface: { label: "HuggingFace",      tier: "free",   type: "huggingface"   },
};

/**
 * Deteksi provider aktif dari .env.
 * Urutan pengecekan:
 *   1. MODEL_PROVIDER (eksplisit, paling direkomendasikan)
 *   2. MODEL_URL — cocokkan domain ke provider yg dikenal
 *   3. Fallback → "ollama"
 */
export function detectProvider() {
  if (process.env.MODEL_PROVIDER) {
    return process.env.MODEL_PROVIDER.toLowerCase();
  }

  const url = (process.env.MODEL_URL || "").toLowerCase();
  if (url.includes("groq.com"))              return "groq";
  if (url.includes("nvidia.com"))            return "nvidia";
  if (url.includes("openrouter.ai"))         return "openrouter";
  if (url.includes("openai.com"))            return "openai";
  if (url.includes("googleapis.com"))        return "gemini";
  if (url.includes("anthropic.com"))         return "anthropic";
  if (url.includes("huggingface.co"))        return "huggingface";
  if (url.includes("localhost") || url.includes("127.0.0.1") || url.includes("ollama")) return "ollama";

  return "ollama"; // fallback aman — tidak butuh API key
}

/**
 * Factory utama. Buat LLM instance berdasarkan .env + bind tools kalau ada.
 * Semua parameter opsional — kalau tidak diisi, semua dibaca dari .env.
 *
 * @param {Array}  tools      - Array LangChain tools (untuk binding)
 * @param {string} [provider] - Override provider (default: auto-detect dari .env)
 * @param {object} [opts]     - Override tambahan (apiKey, model, dsb)
 * @returns {Promise<import("@langchain/core/language_models/chat_models").BaseChatModel>}
 */
export async function createLLM(tools = [], provider, opts = {}) {
  const p = (provider || detectProvider()).toLowerCase();
  const meta = PROVIDERS[p];

  if (!meta) {
    throw new Error(
      `[PROVIDER] Provider tidak dikenal: "${p}".\n` +
      `Provider yang tersedia: ${Object.keys(PROVIDERS).join(", ")}`
    );
  }

  if (meta.type === "anthropic") {
    return createAnthropicLLM({ tools, ...opts });
  }

  if (meta.type === "huggingface") {
    return createHuggingFaceLLM({ tools, ...opts });
  }

  // Default: openai-compat
  return createOpenAICompatLLM(p, { tools, ...opts });
}

/**
 * Kembalikan metadata provider aktif (untuk status display, setup, dll).
 */
export function getProviderMeta(provider) {
  const p = provider || detectProvider();
  return { key: p, ...(PROVIDERS[p] || { label: p, tier: "unknown", type: "unknown" }) };
}

export default { createLLM, detectProvider, getProviderMeta, PROVIDERS };
