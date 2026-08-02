import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from 'url';

import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";

import {
  loadSession,
  saveSession,
} from "./memory.js";

import { recordToolSequence, SKILL_THRESHOLD } from "../utils/patternTracker.js";

// ==========================================
// FIX: Resolve paths relative to this file's location
// ==========================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SKILL_DIR = path.join(ROOT_DIR, 'skill');

let cachedSystemPrompts = {};

// Dipanggil oleh Web UI setelah AGENT.md / SOUL.md disimpan, supaya
// system prompt yang sedang di-cache di memori langsung ke-refresh
// tanpa perlu restart proses EMORA. Juga dipanggil skill_factory.js
// setiap kali skill baru dibuat, supaya katalog skill (lihat
// buildSkillCatalog di bawah) langsung ke-refresh tanpa restart juga.
export function invalidateSystemPromptCache() {
  cachedSystemPrompts = {};
}

/**
 * Scan folder skill/ dan bangun katalog ringkas (nama + deskripsi tiap
 * skill) untuk disisipkan ke system prompt. Ini yang bikin agent TAU skill
 * apa aja yang tersedia di SETIAP turn tanpa harus nebak nama folder atau
 * nanya ke user dulu — lihat AGENT.md bagian 13 (SKILL ACCESS).
 */
async function buildSkillCatalog() {
  let entries;
  try {
    entries = await fs.readdir(SKILL_DIR, { withFileTypes: true });
  } catch {
    return "(Belum ada skill tersimpan.)";
  }

  const lines = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.endsWith(".disabled")) continue; // di-nonaktifkan lewat TUI skills manager (/skills)

    let description = null;
    try {
      const metaRaw = await fs.readFile(path.join(SKILL_DIR, e.name, "meta.json"), "utf8");
      description = JSON.parse(metaRaw).description || null;
    } catch {
      // meta.json gak ada/rusak -> fallback ke baris pertama skill.md
      try {
        const mdRaw = await fs.readFile(path.join(SKILL_DIR, e.name, "skill.md"), "utf8");
        description = mdRaw.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "") || null;
      } catch {
        // skill.md juga gak ada -> skip skill ini dari katalog
      }
    }

    if (description) lines.push(`- ${e.name}: ${description}`);
  }

  return lines.length ? lines.join("\n") : "(Belum ada skill tersimpan.)";
}

export { buildSkillCatalog as buildSkillCatalogForCLI };

/**
 * Bangun ringkasan singkat library untuk disisipkan ke system prompt.
 * Hanya daftar topik+subtopik+jumlah file — TIDAK membaca isi file sama sekali.
 * Model kecil sekalipun bisa memproses ringkasan ini tanpa context overflow.
 */
async function buildLibrarySummary() {
  try {
    const { listTopics, loadIndex } = await import("../library/index.js");
    const topics  = listTopics();
    const catalog = loadIndex();

    if (!Object.keys(topics).length) {
      return "(Library kosong. Gunakan knowledge_library action:write untuk menambah knowledge pertama.)";
    }

    const lines = [`Total ${catalog.count} dokumen di ${Object.keys(topics).length} topik:`];
    for (const [topic, subs] of Object.entries(topics)) {
      lines.push(`• ${topic}: ${subs.join(", ")}`);
    }
    return lines.join("\n");
  } catch {
    return "(Library tidak tersedia atau belum diinisialisasi.)";
  }
}

async function getSystemPrompt() {
  const agentPath = process.env.EMORA_AGENT_PATH || path.join(ROOT_DIR, 'AGENT.md');
  if (cachedSystemPrompts[agentPath]) {
    return cachedSystemPrompts[agentPath];
  }

  try {
    const name = process.env.NAME || "Emora";
    const soulPath = process.env.EMORA_SOUL_PATH || path.join(ROOT_DIR, 'SOUL.md');

    // ==========================================
    // PERF #1: I/O paralel.
    // 4 operasi async independen (baca SOUL.md, baca AGENT.md, scan
    // folder skill, load index library) sekarang jalan bersamaan via
    // Promise.all, bukan berurutan -> total waktu = durasi paling
    // lama, bukan jumlah semuanya. Hanya berjalan sekali per proses
    // (hasil di-cache di cachedSystemPrompt) tapi memangkas latency
    // request pertama / setelah cache di-invalidate.
    // ==========================================
    const [soul, agent, skillCatalog, librarySummary] = await Promise.all([
      fs.readFile(soulPath, "utf8"),
      fs.readFile(agentPath, "utf8"),
      buildSkillCatalog(),
      buildLibrarySummary(),
    ]);
    
    const Context = `
 user identity
 name: ${name}

 ${soul}

 ${agent}

[DYNAMIC RESPONSE LENGTH GUIDELINES]
- Untuk salam/sapaan sederhana, konfirmasi singkat, atau pertanyaan kasual (contoh: "hai", "siapa kamu", "terima kasih", "ok"): Jawab secara LANGSUNG, SINGKAT, dan RAMAH dalam 1-3 kalimat. Jangan bertele-tele atau membuat penjelasan panjang yang tidak diminta.
- Untuk pertanyaan teknis, instruksi pembuatan kode, analisis data, atau tugas proyek (contoh: "buatkan script", "jelaskan cara kerja", "debug error"): Jawab secara LENGKAP, TERSTRUKTUR, dan RINCI dengan blok kode & penjelasan jelas.

[AVAILABLE SKILLS]
${skillCatalog}

Use skill_factory (action: read_skill, skill_name_target: "<name>") to load the FULL content of any skill above WHENEVER its description matches what the user is asking — do this silently as part of normal tool use. NEVER ask the user "should I use the <name> skill?" or announce that you are checking for a skill first; just check this catalog and act, the same way you wouldn't ask permission before using read_file. Only mention a skill by name afterward if it's genuinely useful context for the user (e.g., explaining why you followed a particular workflow).

[KNOWLEDGE LIBRARY]
${librarySummary}

MANDATORY LIBRARY WORKFLOW: Before answering any factual question about topics that could exist in the library, SILENTLY call knowledge_library (action: check) first. If relevant knowledge exists → read it and use it to answer. If not found → answer from your own knowledge, but mention the library doesn't have this topic yet and offer to collect+save it. Never load the entire library at once — only read specific files that are relevant.
 `;

    cachedSystemPrompts[agentPath] = Context;
    return Context;
  } catch (err) {
    console.error(`[CHAT ERROR] Failed to load system prompt: ${err.message}`);
    console.error(`[CHAT ERROR] Looking for SOUL.md and AGENT.md in: ${ROOT_DIR}`);
    
    // Fallback prompt if files not found
    const name = process.env.NAME || "Emora";
    cachedSystemPrompt = `
 user identity
 name: ${name}

 You are ${name}, an AI assistant.
 `;
    return cachedSystemPrompt;
  }
}

// ==========================================
// PERF #2: Context window.
// Sebelumnya SELURUH riwayat sesi (bisa ratusan pesan) dikirim ulang ke
// LLM di SETIAP turn. Itu bikin prompt makin gemuk makin lama sesi
// berjalan -> makin lambat & makin mahal, padahal model jarang butuh
// detail dari ratusan pesan ke belakang. Memory mentah di disk TETAP
// utuh (lihat memory.js) — yang dipangkas hanya potongan yang dikirim
// ke LLM untuk membentuk jawaban saat ini.
// ==========================================
const MAX_CONTEXT_MESSAGES = 24; // ~12 pertukaran user/assistant terakhir

function memoryToMessages(memory) {
  const windowed = memory.slice(-MAX_CONTEXT_MESSAGES);

  return windowed
    .map((msg) => {
      switch (msg.role) {
        case "user":
          return new HumanMessage(msg.content);
        case "assistant":
          return new AIMessage(msg.content);
        default:
          return null;
      }
    })
    .filter(Boolean);
}

// ==========================================
// APPROVAL GATE (dipakai TUI & gateway platform commands)
// ==========================================
// Tool yang selalu aman (read-only / memang didesain jalan diam-diam,
// lihat instruksi "silently call knowledge_library" di system prompt).
// Sengaja TIDAK termasuk tool yang mengubah state / punya efek samping.
const ALWAYS_SAFE_TOOLS = new Set([
  "read_file", "list_files", "search_text", "find_folder",
  "datetime", "system_monitor", "knowledge_library", "read_skill",
]);

// Tool "ringan" yang di mode autonomous boleh auto-approve (mirip
// write_file/edit_file di versi Go). Di mode "safe" tetap wajib approval.
const LIGHT_WRITE_TOOLS = new Set(["write_file", "create_folder"]);

/**
 * Putuskan apakah sebuah tool call butuh persetujuan user sebelum
 * dieksekusi. Kembalikan { allowed, autoApproved, reason }.
 * `onApproval(name, args, mode) => boolean|Promise<boolean>` hanya
 * dipanggil kalau benar-benar perlu — supaya TUI/gateway tidak
 * menampilkan prompt untuk tool yang jelas aman.
 */
async function resolveApproval(name, args, mode, onApproval) {
  if (!onApproval) return { allowed: true, autoApproved: false };
  if (ALWAYS_SAFE_TOOLS.has(name)) return { allowed: true, autoApproved: false };

  if (mode !== "safe" && LIGHT_WRITE_TOOLS.has(name)) {
    return { allowed: true, autoApproved: true, reason: `Auto-approved (mode autonomous): ${name}` };
  }

  const approved = await onApproval(name, args, mode);
  return { allowed: !!approved, autoApproved: false };
}

function abortError() {
  const err = new Error("Dibatalkan oleh user.");
  err.aborted = true;
  return err;
}

async function executeTool(toolCall, tools, { signal } = {}) {
  const tool = tools.find((t) => t.name === toolCall.name);

  if (!tool) {
    return new ToolMessage({
      tool_call_id: toolCall.id,
      content: JSON.stringify({
        success: false,
        error: `Tool '${toolCall.name}' tidak ditemukan`,
      }),
    });
  }

  try {
    const result = await tool.invoke(toolCall.args, signal ? { signal } : undefined);
    return new ToolMessage({
      tool_call_id: toolCall.id,
      content: typeof result === "string" ? result : JSON.stringify(result, null, 2),
    });
  } catch (err) {
    return new ToolMessage({
      tool_call_id: toolCall.id,
      content: JSON.stringify({
        success: false,
        error: err.message,
      }),
    });
  }
}

async function invokeWithRetry(llm, messages, { signal, maxRetries = 3 } = {}) {
  let attempt = 0;
  while (attempt < maxRetries) {
    if (signal?.aborted) throw abortError();
    try {
      const timeoutSignal = AbortSignal.timeout(35000);
      const activeSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      return await llm.invoke(messages, { signal: activeSignal });
    } catch (err) {
      if (err?.name === "AbortError" || signal?.aborted) throw abortError();
      attempt++;
      const isToolError = err?.status === 400 || err?.code === 'tool_use_failed';

      if (isToolError && attempt < maxRetries) {
        console.warn(`\n[LLM WARNING] Malformed tool call detected. Retrying... (Attempt ${attempt}/${maxRetries})`);
        continue;
      }

      throw err;
    }
  }
}

// ==========================================
// PERF #3: Fast-path untuk chat pendek/basa-basi.
// AGENT.md mewajibkan cek knowledge_library untuk "pertanyaan faktual"
// dan skill catalog untuk permintaan yang cocok skill — bagus untuk
// pertanyaan substantif, tapi kalau model salah generalisasi ke pesan
// kasual ("hai", "makasih", "oke") itu nambah 1 round-trip tool call
// penuh (invoke -> tool -> invoke lagi) yang gampang bikin total waktu
// respon > 5 detik untuk chat sepele. Deteksi heuristik ringan di sini
// dan sisipkan catatan kecil (bukan ubah AGENT.md) yang menegaskan:
// kalau pesan ini kasual & tidak butuh pengetahuan/skill spesifik,
// jawab langsung tanpa tool. Kalau ternyata memang butuh tool, model
// tetap bebas memanggilnya — ini cuma hint, bukan larangan keras.
// ==========================================
const SMALLTALK_RE = /^(hai|halo+|hi|hei|hy|hello|hey|p+ag+i|si+ang|so+re|ma+lam|thanks?|thx|makasih|terima\s*kasih|oke*|ok|sip|mantap|ya|iya|gpp|santai|wkwk+|haha+|bye|dadah|see\s*ya)[\s!.,?]*$/i;

function isLikelyShortChat(input) {
  const trimmed = (input || "").trim();
  if (!trimmed) return false;
  if (trimmed.length <= 40 && SMALLTALK_RE.test(trimmed)) return true;
  if (trimmed.length <= 12 && !/[?]/.test(trimmed)) return true; // super pendek & bukan pertanyaan
  return false;
}

export async function ask(llm, tools, sessionId, input, { onEvent, onApproval, mode = "autonomous", signal } = {}) {
  const t0 = Date.now();
  if (signal?.aborted) throw abortError();
  const systemPrompt = await getSystemPrompt();
  const memory = await loadSession(sessionId);

  let turnSystemPrompt = systemPrompt + `\n\n[INFO SYSTEM]\nSession ID aktif user ini adalah: ${sessionId}`;

  if (isLikelyShortChat(input)) {
    turnSystemPrompt +=
      `\n\n[FAST MODE — pesan turn ini terdeteksi kasual/sangat pendek]\n` +
      `Pesan user kemungkinan besar basa-basi/singkat, BUKAN pertanyaan faktual. ` +
      `Jika benar demikian, balas langsung tanpa memanggil tool apa pun (skip cek knowledge_library ` +
      `dan skip baca skill) supaya respon cepat (target < 5 detik). Kalau ternyata pesan ini ` +
      `tetap butuh tool/fakta spesifik, tetap panggil tool seperti biasa — ini cuma hint, bukan larangan.`;
  }

  const messages = [
    new SystemMessage(turnSystemPrompt),
    ...memoryToMessages(memory),
    new HumanMessage(input),
  ];

  let response;

  try {
    response = await invokeWithRetry(llm, messages, { signal });
  } catch (err) {
    if (err?.aborted) throw err;
    if (err?.status === 401 || err?.message?.includes("Invalid API Key") || err?.code === "invalid_api_key") {
      return (
        `⚠️ **[ERROR AUTHENTICATION - 401 Invalid API Key]**\n\n` +
        `API key yang dikonfigurasi di file \`.env\` untuk provider **${process.env.MODEL_PROVIDER || 'AI'}** tidak valid atau sudah tidak aktif.\n\n` +
        `💡 **Cara Mengatasi:**\n` +
        `1. Ketik **\`emora model\`** atau **\`emora setup\`** di terminal untuk memasukkan API Key baru.\n` +
        `2. Atau buat API Key gratis baru dari:\n` +
        `   - **Groq:** https://console.groq.com\n` +
        `   - **Google Gemini:** https://aistudio.google.com/app/apikey`
      );
    }
    console.error("\n[LLM ERROR]");
    console.dir(err, { depth: null });
    throw err;
  }

  // ==========================================
  // SKILL FACTORY: Lacak semua tool yang dipanggil di turn ini
  // ==========================================
  const toolsUsedThisTurn = [];

  while (response?.tool_calls?.length) {
    if (signal?.aborted) throw abortError();
    messages.push(response);

    for (const toolCall of response.tool_calls) {
      if (signal?.aborted) throw abortError();

      if (toolCall.name !== "skill_factory") {
        toolsUsedThisTurn.push(toolCall.name);
      }

      // ── Approval gate (no-op unless caller passed onApproval) ─────────
      const decision = await resolveApproval(toolCall.name, toolCall.args, mode, onApproval);

      if (!decision.allowed) {
        if (onEvent) onEvent({ type: "tool_denied", name: toolCall.name, args: toolCall.args });
        messages.push(new ToolMessage({
          tool_call_id: toolCall.id,
          content: JSON.stringify({ success: false, error: "Ditolak oleh user." }),
        }));
        continue;
      }

      // ── Real-time event callback ──────────────────────────────────────
      if (onEvent) {
        if (toolCall.name === "skill_factory" && toolCall.args?.action === "read_skill") {
          onEvent({ type: "skill_read", name: toolCall.args.skill_name_target || "?" });
        } else {
          onEvent({ type: "tool_use", name: toolCall.name, args: toolCall.args, autoApproved: decision.autoApproved });
        }
      }

      const toolResult = await executeTool(toolCall, tools, { signal });

      // Emit result event so CLI can show output preview + timing
      if (onEvent && toolCall.name !== "skill_factory") {
        const resultContent = toolResult?.content
          ? (Array.isArray(toolResult.content)
              ? toolResult.content.map(c => c.text || "").join("")
              : String(toolResult.content))
          : "";
        onEvent({ type: "tool_result", name: toolCall.name, result: resultContent });
      }

      messages.push(toolResult);
    }

    if (signal?.aborted) throw abortError();

    try {
      response = await invokeWithRetry(llm, messages, { signal });
    } catch (err) {
      if (err?.aborted) throw err;
      console.error("\n[LLM ERROR DURING TOOL RESPONSE]");
      console.dir(err, { depth: null });
      throw err;
    }
  }

  // ==========================================
  // SKILL FACTORY: Cek pola & inject notifikasi jika threshold tercapai
  // ==========================================
  let finalContent = response.content;

  // Normalisasi: LangChain (tergantung provider) kadang balikin content
  // sebagai array of content block (mis. gaya Anthropic [{type:"text",
  // text:"..."}]) alih-alih string polos. Kalau ini gak dinormalisasi,
  // `finalContent` bisa lolos ke caller (TUI/Telegram/WhatsApp/Discord)
  // sebagai non-string dan berujung "kosong" pas ditampilkan/dikirim.
  if (Array.isArray(finalContent)) {
    finalContent = finalContent
      .map((c) => (typeof c === "string" ? c : c?.text || ""))
      .join("")
      .trim();
  } else if (typeof finalContent !== "string") {
    finalContent = finalContent == null ? "" : String(finalContent);
  }

  // Kadang provider/model balikin completion BENAR-BENAR kosong (quirk
  // yang kadang muncul, terutama abis serangkaian tool call) walau
  // tool_calls-nya juga sudah habis. Daripada kirim pesan kosong ke user
  // di Telegram/WhatsApp/Discord/TUI, coba re-invoke SEKALI dengan nudge,
  // dan kalau masih kosong juga pakai fallback message yang jujur —
  // never return an empty string from ask().
  if (!finalContent.trim()) {
    try {
      if (signal?.aborted) throw abortError();
      const nudgeMessages = [
        ...messages,
        new HumanMessage("(Sistem: responsmu barusan kosong. Tolong berikan jawaban singkat untuk pesan user sebelumnya.)"),
      ];
      const retryResponse = await invokeWithRetry(llm, nudgeMessages, { signal });
      let retryContent = retryResponse?.content;
      if (Array.isArray(retryContent)) {
        retryContent = retryContent.map((c) => (typeof c === "string" ? c : c?.text || "")).join("").trim();
      }
      finalContent = (typeof retryContent === "string" && retryContent.trim())
        ? retryContent
        : "Maaf, aku belum nemu jawaban yang jelas buat pesan ini. Coba tanya ulang dengan kalimat yang beda ya?";
    } catch (err) {
      if (err?.aborted) throw err;
      finalContent = "Maaf, aku belum nemu jawaban yang jelas buat pesan ini. Coba tanya ulang dengan kalimat yang beda ya?";
    }
  }

  if (toolsUsedThisTurn.length >= 2) {
    try {
      const triggered = await recordToolSequence(sessionId, toolsUsedThisTurn);
      if (triggered) {
        const sequenceDisplay = triggered.pattern.sequence.join(" → ");
        finalContent +=
          `\n\n---\n` +
          `💡 **[SKILL FACTORY]** Gw nyadar lo udah pake workflow \`${sequenceDisplay}\` sebanyak **${triggered.pattern.count}x**. ` +
          `Gw bisa otomatis buatin skill dari pola ini supaya bisa dipake lagi atau dijadwalin. ` +
          `Ketik **"buat skill untuk pola ini"** kalau mau, atau **"lihat pola terdeteksi"** buat cek semua pola yang ada.`;
      }
    } catch (e) {
      // Pattern tracking gagal jangan sampai ganggu response utama
    }
  }

  memory.push({
    role: "user",
    content: input,
    timestamp: Date.now(),
  });

  memory.push({
    role: "assistant",
    content: finalContent,
    timestamp: Date.now(),
  });

  await saveSession(sessionId, memory);

  const elapsedMs = Date.now() - t0;
  if (process.env.EMORA_DEBUG_TIMING === "1") {
    console.log(`[TIMING] turn selesai dalam ${elapsedMs}ms (session=${sessionId})`);
  }

  return finalContent;
}
