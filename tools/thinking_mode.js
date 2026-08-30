/**
 * tools/thinking_mode.js
 *
 * Toggle "thinking mode" (chain-of-thought) untuk model reasoning gaya
 * Qwen3 / Qwen3.5 lewat soft-switch resmi mereka: menyisipkan literal
 * "/think" atau "/no_think" di pesan user. Ini cara PALING portable —
 * jalan lewat endpoint OpenAI-compat Ollama, native /api/chat, vLLM,
 * dsb — karena cukup teks biasa yang dibaca chat template model, bukan
 * parameter API khusus yang belum tentu di-passthrough tiap backend.
 *
 * Persist ke .emora/thinking.json supaya TUI/gateway baca nilai sama —
 * pola sama seperti tools/change_mode.js.
 *
 *   "auto" → default. Kalau model TERDETEKSI kecil (≤1.5B, lihat
 *            core/agentMode.js isSmallModel) → otomatis dianggap "off"
 *            (skip mikir, respons cepat & hemat token). Model besar →
 *            tidak disisipi tag apa pun, ikut default template model.
 *   "on"   → paksa mikir (/think) tiap giliran. Lebih akurat, lebih lambat.
 *   "off"  → paksa skip mikir (/no_think) tiap giliran. Lebih cepat,
 *            cocok untuk model kecil seperti qwen3.5:0.8b.
 *
 * Sengaja TIDAK didaftarkan sebagai tool ke LLM (lihat core/tools.js) —
 * model sekecil 0.8B sudah pas-pasan menangani skema tool call yang ada;
 * menambah satu tool lagi cuma menambah beban tanpa manfaat besar.
 * Kontrol murni lewat slash command "/thinking" (tui/slashCommands.js).
 */
import fs from "fs/promises";
import path from "path";
import { isSmallModel } from "../core/agentMode.js";

const THINKING_FILE = ".emora/thinking.json";
const VALID = ["auto", "on", "off"];

export async function getThinking() {
  try {
    const raw = JSON.parse(await fs.readFile(THINKING_FILE, "utf8"));
    return VALID.includes(raw.thinking) ? raw.thinking : "auto";
  } catch {
    return "auto";
  }
}

export async function setThinking(value) {
  const v = String(value || "").toLowerCase();
  if (!VALID.includes(v)) {
    return { ok: false, error: `Nilai tidak valid: "${value}". Pilihan: ${VALID.join(", ")}` };
  }
  await fs.mkdir(path.dirname(THINKING_FILE), { recursive: true });
  await fs.writeFile(THINKING_FILE, JSON.stringify({ thinking: v, ts: Date.now() }));
  return { ok: true, thinking: v };
}

/**
 * Sisipkan soft-switch Qwen3 ke teks input user kalau perlu.
 * @param {string} text     - effectiveInput sebelum dikirim ke LLM.
 * @param {string} mode     - hasil getThinking(): "auto" | "on" | "off".
 * @param {string} modelId  - process.env.MODEL_NAME, dipakai untuk auto-detect model kecil.
 */
export function applyThinkingTag(text, mode, modelId = "") {
  if (mode === "on") return `${text}\n\n/think`;
  if (mode === "off") return `${text}\n\n/no_think`;

  // mode === "auto" → tetap cek apakah model ini kecil (0.8B, dst, lihat
  // core/agentMode.js isSmallModel). Kalau iya, default-kan ke /no_think
  // supaya "lancar" tanpa perlu user set manual tiap kali ganti model.
  // Model besar/tidak dikenali → biarkan apa adanya, ikut default model.
  try {
    if (isSmallModel(modelId)) return `${text}\n\n/no_think`;
  } catch { /* gagal deteksi → fallback aman: jangan sisipi apa-apa */ }
  return text;
}

export default { getThinking, setThinking, applyThinkingTag };
