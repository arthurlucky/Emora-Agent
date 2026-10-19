/**
 * core/capabilities.js — matriks kapabilitas provider (tunggal).
 * Menggantikan flag tersebar (CUSTOM_NO_PARALLEL_TOOLS, streaming:false di gemini, dll).
 */
export const PROVIDER_CAPABILITIES = {
  groq:       { parallelTools: false, streaming: true,  defaultMaxTokens: 2048, thinkingTag: false, note: "parallel dimatikan: urutan ToolMessage tidak stabil" },
  gemini:     { parallelTools: true,  streaming: false, defaultMaxTokens: 8192, thinkingTag: false, note: "streaming+toolcall kadang truncate" },
  openrouter: { parallelTools: true,  streaming: true,  defaultMaxTokens: 4096, thinkingTag: false, note: "wajib HTTP-Referer + X-Title" },
  nvidia:     { parallelTools: true,  streaming: true,  defaultMaxTokens: 4096, thinkingTag: false, note: "" },
  openai:     { parallelTools: true,  streaming: true,  defaultMaxTokens: 4096, thinkingTag: false, note: "" },
  deepseek:   { parallelTools: true,  streaming: true,  defaultMaxTokens: 4096, thinkingTag: true,  note: "R1 mendukung reasoning" },
  ollama:     { parallelTools: false, streaming: true,  defaultMaxTokens: 4096, thinkingTag: true,  note: "model kecil: matikan parallel, dukung /think" },
  anthropic:  { parallelTools: true,  streaming: true,  defaultMaxTokens: 4096, thinkingTag: false, note: "via @langchain/anthropic" },
  huggingface:{ parallelTools: false, streaming: true,  defaultMaxTokens: 2048, thinkingTag: false, note: "inference API tidak stabil untuk parallel" },
  custom:     { parallelTools: "auto", streaming: true, defaultMaxTokens: 4096, thinkingTag: true,  note: "auto: hormati CUSTOM_NO_PARALLEL_TOOLS" },
};

export function getCapabilities(providerKey) {
  const k = (providerKey || "").toLowerCase();
  return PROVIDER_CAPABILITIES[k] || { parallelTools: true, streaming: true, defaultMaxTokens: 4096, thinkingTag: false, note: "unknown provider: default aman" };
}

export function shouldUseParallel(providerKey) {
  const cap = getCapabilities(providerKey);
  if (cap.parallelTools === "auto") {
    return process.env.CUSTOM_NO_PARALLEL_TOOLS !== "true";
  }
  return !!cap.parallelTools;
}
