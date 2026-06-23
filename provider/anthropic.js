/**
 * provider/anthropic.js
 *
 * Provider untuk Anthropic Claude (claude-3-5-sonnet, claude-3-haiku, dsb).
 * Butuh dependency tambahan: npm install @langchain/anthropic
 *
 * Kenapa BUKAN pakai endpoint OpenAI-compat Anthropic:
 * - Tool calling (function calling) dari ChatOpenAI + Anthropic base_url
 *   sering gagal karena format request/response berbeda.
 * - @langchain/anthropic handle konversi ToolMessage <-> Anthropic format
 *   secara native — jauh lebih stabil untuk agent loop.
 *
 * Optimasi untuk agent:
 * - extended_thinking = false (default) → tool calling lebih cepat & konsisten
 * - temperature 0.2 → balance kreativitas vs deterministik
 * - max_tokens 8192 → Claude perlu token yang cukup buat reasoning + tool result
 */

let ChatAnthropic;

async function loadAnthropic() {
  if (ChatAnthropic) return ChatAnthropic;
  try {
    const mod = await import("@langchain/anthropic");
    ChatAnthropic = mod.ChatAnthropic;
    return ChatAnthropic;
  } catch {
    throw new Error(
      "[PROVIDER:anthropic] @langchain/anthropic belum terinstall.\n" +
      "Jalankan: npm install @langchain/anthropic\n" +
      "Kemudian setup ulang provider dengan: emora model"
    );
  }
}

export const ANTHROPIC_MODELS = [
  { id: "claude-opus-4-5",       label: "claude-opus-4-5       [Paling cerdas, lambat]",  tier: "paid" },
  { id: "claude-sonnet-4-5",     label: "claude-sonnet-4-5     [Balance terbaik]",         tier: "paid" },
  { id: "claude-haiku-4-5",      label: "claude-haiku-4-5      [Cepat & hemat]",           tier: "paid" },
  { id: "claude-3-5-sonnet-20241022", label: "claude-3-5-sonnet-20241022 [Stable]",        tier: "paid" },
  { id: "claude-3-haiku-20240307",    label: "claude-3-haiku-20240307   [Hemat banget]",   tier: "paid" },
];

export async function createAnthropicLLM({ apiKey, model, tools } = {}) {
  const Cls = await loadAnthropic();

  const llm = new Cls({
    apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    model: model || process.env.MODEL_NAME || "claude-sonnet-4-5",
    temperature: 0.2,
    maxTokens: 8192,
    // Jangan aktifkan streaming di agent loop — tool result parsing lebih
    // reliable kalau non-stream. Bisa diaktifkan kalau LLM dipakai tanpa tools.
    streaming: false,
  });

  if (tools?.length) {
    return llm.bindTools(tools, { toolChoice: "auto" });
  }
  return llm;
}
