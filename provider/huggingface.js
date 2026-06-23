/**
 * provider/huggingface.js
 *
 * Provider untuk HuggingFace Inference API.
 *
 * HuggingFace punya endpoint OpenAI-compatible di:
 *   https://api-inference.huggingface.co/v1
 *
 * Jadi kita cukup pakai ChatOpenAI dari @langchain/openai dengan base URL
 * itu + HF token sebagai API key — tidak perlu library tambahan.
 *
 * Catatan penting:
 * - Tool calling hanya didukung model tertentu di HF (kebanyakan model
 *   Mistral, Llama-3.1-instruct, dsb). Model yang tidak support akan error
 *   dengan "tool_calls not supported". Cek daftar model yang support di:
 *   https://huggingface.co/docs/api-inference/supported-models
 * - Rate limit HF gratis sangat ketat (6 req/min). Kalau sering timeout,
 *   ganti ke HF Pro atau pakai dedicated endpoint.
 * - custom model di HF bisa dipakai kalau user punya dedicated endpoint
 *   (HF Inference Endpoints) — isi HUGGINGFACE_ENDPOINT_URL di .env.
 */

import { ChatOpenAI } from "@langchain/openai";

// Model HF yang terbukti support tool calling di Inference API publik
export const HUGGINGFACE_MODELS = [
  {
    id: "meta-llama/Meta-Llama-3.1-70B-Instruct",
    label: "Llama 3.1 70B Instruct  [Terbaik, butuh HF Pro]",
    tier: "pro",
  },
  {
    id: "meta-llama/Meta-Llama-3.1-8B-Instruct",
    label: "Llama 3.1 8B Instruct   [Gratis, lebih kecil]",
    tier: "free",
  },
  {
    id: "mistralai/Mistral-7B-Instruct-v0.3",
    label: "Mistral 7B Instruct v0.3 [Gratis, tool calling OK]",
    tier: "free",
  },
  {
    id: "Qwen/Qwen2.5-72B-Instruct",
    label: "Qwen 2.5 72B Instruct   [Bagus, butuh HF Pro]",
    tier: "pro",
  },
  {
    id: "custom",
    label: "Custom Endpoint          [Dedicated HF Endpoint]",
    tier: "custom",
  },
];

export function createHuggingFaceLLM({ apiKey, model, customEndpoint, tools } = {}) {
  const hfToken = apiKey || process.env.HUGGINGFACE_API_KEY;
  if (!hfToken) {
    throw new Error(
      "[PROVIDER:huggingface] HUGGINGFACE_API_KEY belum di-set di .env.\n" +
      "Dapatkan token gratis di: https://huggingface.co/settings/tokens"
    );
  }

  // Kalau ada dedicated endpoint (HF Inference Endpoints), pakai itu
  const dedicatedEndpoint = customEndpoint || process.env.HUGGINGFACE_ENDPOINT_URL;

  let baseURL, modelId;
  if (dedicatedEndpoint) {
    // Dedicated endpoint punya format berbeda — tidak ada /v1/chat/completions
    // tapi HF Inference Endpoints mendukung OpenAI-compat kalau framework-nya
    // disetel ke "text-generation-inference" (TGI)
    baseURL = dedicatedEndpoint.endsWith("/v1") ? dedicatedEndpoint : `${dedicatedEndpoint}/v1`;
    // Model ID tidak diperlukan kalau endpoint sudah dedicated ke satu model
    modelId = model || "tgi";
  } else {
    baseURL = "https://api-inference.huggingface.co/v1";
    modelId = model || process.env.MODEL_NAME || "meta-llama/Meta-Llama-3.1-8B-Instruct";
  }

  const llm = new ChatOpenAI({
    apiKey: hfToken,
    model: modelId,
    configuration: { baseURL },
    temperature: 0.2,
    maxTokens: 2048, // HF gratis punya hard limit lebih rendah
    // HF TIDAK support parallel_tool_calls → wajib false
    modelKwargs: { parallel_tool_calls: false },
  });

  if (tools?.length) {
    return llm.bindTools(tools, { toolChoice: "auto" });
  }
  return llm;
}
