// provider/deepseek/index.js
//
// Dua jalur:
// 1. API RESMI (prioritas) — api.deepseek.com, OpenAI-compatible via
//    ChatOpenAI. Tool calling penuh, stabil. Butuh DEEPSEEK_API_KEY
//    (https://platform.deepseek.com/api_keys) — harga sangat murah.
// 2. SCRAPE (fallback gratis) — aichat.org, tanpa API key tapi rapuh &
//    tanpa tool calling. Dipakai otomatis kalau API key tidak ada.
//
// Pilihan jalur: otomatis (ada key → API), atau paksa via DEEPSEEK_MODE=api|scrape.

import fsSync from "fs";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";

export const PROVIDER_ID    = "deepseek";
export const PROVIDER_LABEL = "DeepSeek";
export const PROVIDER_TIER  = "free"; // scrape gratis; API sangat murah
export const KEY_URL        = "https://platform.deepseek.com/api_keys";
export const BASE_URL       = "https://api.deepseek.com/v1";
const SCRAPE_BASE           = "https://aichat.org";

export const MODELS = [
  // ── API RESMI (butuh DEEPSEEK_API_KEY) ──
  {
    id:      "deepseek-chat",
    label:   "DeepSeek V3 (API resmi)  — tool calling OK, sangat murah [API]",
    context: 65536,
    tier:    "paid", // murah, bukan gratis
  },
  {
    id:      "deepseek-reasoner",
    label:   "DeepSeek R1 (API resmi) — reasoning kuat, tanpa tool calling [API]",
    context: 65536,
    tier:    "paid",
  },
  // ── SCRAPE (gratis, eksperimental — situs pihak ketiga bisa berubah kapan saja) ──
  {
    id:      "deepseek-chat-v3-0324-scrape",
    label:   "DeepSeek V3 (scrape)     — EKSPERIMENTAL, gratis, TANPA tool calling",
    context: 65536,
    tier:    "free",
  },
];

export const DEFAULT_MODEL = "deepseek-chat";

/** Jalur mana yang dipakai: api kalau ada key & tidak dipaksa scrape. */
function resolveMode(model) {
  const forced = (process.env.DEEPSEEK_MODE || "").toLowerCase();
  if (forced === "scrape") return "scrape";
  if (forced === "api") return "api";
  const hasKey = !!(process.env.DEEPSEEK_API_KEY || process.env.MODEL_API);
  // Model scrape eksplisit → scrape walau ada key.
  if (String(model).endsWith("-scrape")) return hasKey ? "api" : "scrape";
  return hasKey ? "api" : "scrape";
}

/**
 * @param {{ apiKey?: string, model?: string, tools?: any[] }} opts
 */
export function createLLM({ apiKey, model, tools = [] } = {}) {
  const chosenModel = model || process.env.MODEL_NAME || DEFAULT_MODEL;
  const mode = resolveMode(chosenModel);

  if (mode === "api") {
    // Normalisasi: "-scrape" suffix → id API asli.
    const cleanModel = chosenModel.replace(/-scrape$/, "");
    const llm = new ChatOpenAI({
      apiKey: apiKey || process.env.DEEPSEEK_API_KEY || process.env.MODEL_API,
      model: cleanModel,
      configuration: { baseURL: BASE_URL },
      temperature: 0.2,
      maxTokens: 4096,
    });
    return tools.length ? llm.bindTools(tools, { toolChoice: "auto" }) : llm;
  }

  // Fallback scrape — tanpa tool calling.
  return new DeepSeekScrapeChatModel({
    model: chosenModel,
    sessionFile: null, // histori dikelola memory EMORA, bukan file scraper
  });
}

// ── SCRAPE FALLBACK (aichat.org) ─────────────────────────────────────────────
class DeepSeekScrapeChatModel extends BaseChatModel {
  constructor(options = {}) {
    super(options);
    this.model = options.model || DEFAULT_MODEL;
  }

  _llmType() {
    return "deepseek-scrape";
  }

  async _generate(messages) {
    // Gabungkan seluruh konteks percakapan (bukan cuma pesan terakhir)
    // supaya agent tetap sadar riwayat dalam batas wajar.
    const convo = messages.slice(-12).map((m) => ({
      role:
        m._getType() === "human" ? "user" :
        m._getType() === "ai" ? "assistant" : "user",
      content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
    })).filter((m) => m.content);

    if (!convo.length) throw new Error("Tidak ada pesan user.");

    const result = await deepseekChat(convo);
    const parsed = JSON.parse(result);
    return {
      generations: [{ text: parsed.content, message: new AIMessage(parsed.content) }],
    };
  }
}

async function deepseekChat(messages) {
  // Lazy import — deps scraper hanya dibutuhkan kalau fallback ini dipakai.
  const axios = (await import("axios")).default;
  const cheerio = (await import("cheerio")).default;
  const { wrapper } = await import("axios-cookiejar-support");
  const { CookieJar } = await import("tough-cookie");
  const jar = new CookieJar();
  const client = wrapper(axios.create({ jar, withCredentials: true }));
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

  // 1. CSRF token
  const initialRes = await client.get(`${SCRAPE_BASE}/chat`, {
    headers: {
      "user-agent": UA,
      accept: "*/*",
      referer: `${SCRAPE_BASE}/chat`,
      origin: SCRAPE_BASE,
    },
  });
  const $ = cheerio.load(initialRes.data);
  const csrfToken = $('meta[name="csrf-token"]').attr("content");
  if (!csrfToken) throw new Error("Gagal mendapatkan CSRF Token dari aichat.org (site berubah?).");

  // 2. Kirim request streaming
  const res = await client.post(
    `${SCRAPE_BASE}/api/chat`,
    { model: "deepseek/deepseek-chat-v3-0324", messages },
    {
      headers: {
        "user-agent": UA,
        accept: "text/event-stream",
        "x-csrf-token": csrfToken,
        "content-type": "application/json",
      },
      responseType: "stream",
      timeout: 60_000,
    },
  );

  // 3. Proses stream
  return new Promise((resolve, reject) => {
    let result = "";
    res.data.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const dataStr = trimmed.replace("data: ", "").trim();
        if (dataStr === "[DONE]") continue;
        try {
          const delta = JSON.parse(dataStr).choices?.[0]?.delta;
          if (delta?.content) result += delta.content;
        } catch {}
      }
    });
    res.data.on("end", () => resolve(JSON.stringify({ content: result.trim() })));
    res.data.on("error", reject);
  });
}

export default { createLLM, MODELS, DEFAULT_MODEL };
