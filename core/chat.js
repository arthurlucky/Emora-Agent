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

let cachedSystemPrompt = null;

// Dipanggil oleh Web UI setelah AGENT.md / SOUL.md disimpan, supaya
// system prompt yang sedang di-cache di memori langsung ke-refresh
// tanpa perlu restart proses EMORA. Juga dipanggil skill_factory.js
// setiap kali skill baru dibuat, supaya katalog skill (lihat
// buildSkillCatalog di bawah) langsung ke-refresh tanpa restart juga.
export function invalidateSystemPromptCache() {
  cachedSystemPrompt = null;
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
  if (cachedSystemPrompt) {
    return cachedSystemPrompt;
  }

  try {
    const name = process.env.NAME || "Emora";
    const soulPath = path.join(ROOT_DIR, 'SOUL.md');
    const agentPath = path.join(ROOT_DIR, 'AGENT.md');

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

[AVAILABLE SKILLS]
${skillCatalog}

Use skill_factory (action: read_skill, skill_name_target: "<name>") to load the FULL content of any skill above WHENEVER its description matches what the user is asking — do this silently as part of normal tool use. NEVER ask the user "should I use the <name> skill?" or announce that you are checking for a skill first; just check this catalog and act, the same way you wouldn't ask permission before using read_file. Only mention a skill by name afterward if it's genuinely useful context for the user (e.g., explaining why you followed a particular workflow).

[KNOWLEDGE LIBRARY]
${librarySummary}

MANDATORY LIBRARY WORKFLOW: Before answering any factual question about topics that could exist in the library, SILENTLY call knowledge_library (action: check) first. If relevant knowledge exists → read it and use it to answer. If not found → answer from your own knowledge, but mention the library doesn't have this topic yet and offer to collect+save it. Never load the entire library at once — only read specific files that are relevant.
 `;

    cachedSystemPrompt = Context;
    return cachedSystemPrompt;
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

async function executeTool(toolCall, tools) {
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
    const result = await tool.invoke(toolCall.args);
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

async function invokeWithRetry(llm, messages, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await llm.invoke(messages);
    } catch (err) {
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

export async function ask(llm, tools, sessionId, input, { onEvent } = {}) {
  const t0 = Date.now();
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
    response = await invokeWithRetry(llm, messages);
  } catch (err) {
    console.error("\n[LLM ERROR]");
    console.dir(err, { depth: null });
    throw err;
  }

  // ==========================================
  // SKILL FACTORY: Lacak semua tool yang dipanggil di turn ini
  // ==========================================
  const toolsUsedThisTurn = [];

  while (response?.tool_calls?.length) {
    messages.push(response);

    for (const toolCall of response.tool_calls) {
      if (toolCall.name !== "skill_factory") {
        toolsUsedThisTurn.push(toolCall.name);
      }

      // ── Real-time event callback ──────────────────────────────────────
      if (onEvent) {
        if (toolCall.name === "skill_factory" && toolCall.args?.action === "read_skill") {
          onEvent({ type: "skill_read", name: toolCall.args.skill_name_target || "?" });
        } else {
          onEvent({ type: "tool_use", name: toolCall.name, args: toolCall.args });
        }
      }

      const toolResult = await executeTool(toolCall, tools);

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

    try {
      response = await invokeWithRetry(llm, messages);
    } catch (err) {
      console.error("\n[LLM ERROR DURING TOOL RESPONSE]");
      console.dir(err, { depth: null });
      throw err;
    }
  }

  // ==========================================
  // SKILL FACTORY: Cek pola & inject notifikasi jika threshold tercapai
  // ==========================================
  let finalContent = response.content;

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
