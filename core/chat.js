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
import skillRegistry from "./skillRegistry.js";
import pluginHooks from "./pluginHooks.js";
import { sanitizeOwnContextFile } from "./promptSafety.js";
import sessionMemory from "./sessionMemory.js";
import { detectProvider } from "../provider/index.js";

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
 * Bangun katalog ringkas (nama + deskripsi) SEMUA skill & command yang
 * dikenal EMORA — bawaan (./skill/) MAUPUN dari plugin (./plugins/<id>/
 * skills|commands/, format standar Claude Code/Hermes Agent) — untuk
 * disisipkan ke system prompt.
 */
async function buildSkillCatalog() {
  const all = await skillRegistry.listAll();
  if (!all.length) return "(Belum ada skill tersimpan.)";

  const lines = all
    .filter((s) => s.description)
    .map((s) => skillRegistry.toCatalogLine(s));

  return lines.length ? lines.join("\n") : "(Belum ada skill tersimpan.)";
}

export { buildSkillCatalog as buildSkillCatalogForCLI, getSystemPrompt };

/**
 * Bangun ringkasan singkat library untuk disisipkan ke system prompt.
 * Hanya daftar topik+subtopik+jumlah file — TIDAK membaca isi file sama sekali.
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

  // ── Auto AGENT_LITE untuk model kecil ──────────────────────────────────
  // Override manual: AGENT_MODE=lite|full di .env menang.
  // Otomatis: nama model mengandung ukuran ≤1.5B atau mini/tiny/nano.
  let effectiveAgentPath = agentPath;
  const agentMode = (process.env.AGENT_MODE || "").toLowerCase();
  const modelName = process.env.MODEL_NAME || "";
  let usedLite = false;
  try {
    if (agentMode === "lite") {
      effectiveAgentPath = path.join(ROOT_DIR, "AGENT_LITE.md");
      usedLite = true;
    } else if (!agentMode && modelName) {
      const { isSmallModel } = await import("../provider/openrouter/index.js").catch(() => ({}));
      if (isSmallModel?.(modelName)) {
        effectiveAgentPath = path.join(ROOT_DIR, "AGENT_LITE.md");
        usedLite = true;
      }
    }
  } catch { /* fallback ke full */ }
  if (usedLite) console.log("[chat] model kecil terdeteksi → memakai AGENT_LITE.md");

  try {
    const name = process.env.NAME || "Emora";
    const soulPath = process.env.EMORA_SOUL_PATH || path.join(ROOT_DIR, 'SOUL.md');

    // PERF #1: I/O paralel via Promise.all.
    const [soulRaw, agentRaw, skillCatalog, librarySummary] = await Promise.all([
      fs.readFile(soulPath, "utf8"),
      fs.readFile(effectiveAgentPath, "utf8"),
      buildSkillCatalog(),
      buildLibrarySummary(),
    ]);

    // TIER "STABLE" — identity + rules + skills index, di-cache & tidak
    // berubah tiap turn (prompt-cache friendly). AGENT.md/SOUL.md lewat
    // sanitizeOwnContextFile(): cek pola prompt-injection + potong head/tail
    // kalau membengkak.
    const soul  = sanitizeOwnContextFile(soulRaw,  "SOUL.md");
    const agent = sanitizeOwnContextFile(agentRaw, "AGENT.md");

    const Context = `
 user identity
 name: ${name}

 ${soul}

 ${agent}

[DYNAMIC RESPONSE LENGTH GUIDELINES]
- Untuk salam/sapaan sederhana, konfirmasi singkat, atau pertanyaan kasual (contoh: "hai", "siapa kamu", "terima kasih", "ok"): Jawab secara LANGSUNG, SINGKAT, dan RAMAH dalam 1-3 kalimat. Jangan bertele-tele atau membuat penjelasan panjang yang tidak diminta.
- Untuk pertanyaan teknis, instruksi pembuatan kode, analisis data, atau tugas proyek (contoh: "buatkan script", "jelaskan cara kerja", "debug error"): Jawab secara LENGKAP, TERSTRUKTUR, dan RINCI dengan blok kode & penjelasan jelas.

[AVAILABLE SKILLS & COMMANDS]
Format tiap baris: "/<nama> [skill|command (plugin:<id> kalau bukan bawaan)]: deskripsi".
${skillCatalog}

Use skill_factory (action: read_skill, skill_name_target: "<name>") to load the FULL content of any entry above WHENEVER its description matches what the user is asking — ini berlaku untuk entry bawaan MAUPUN dari plugin. Do this silently as part of normal tool use. NEVER ask the user "should I use the <name> skill?" or announce that you are checking for a skill first; just check this catalog and act, the same way you wouldn't ask permission before using read_file. Only mention a skill by name afterward if it's genuinely useful context for the user.

Kalau pesan user di turn ini SUDAH diawali blok "[MANUAL SKILL INVOCATION ...]" atau "[MANUAL COMMAND INVOCATION ...]", itu artinya user SENDIRI yang mengetik "/<nama>" secara eksplisit — jalankan instruksinya LANGSUNG (isinya sudah disertakan penuh di blok itu), TANPA baca ulang lewat skill_factory dan TANPA bertanya konfirmasi dulu. Skill/command yang sumbernya plugin pihak ketiga akan diawali penanda "[SUMBER: plugin pihak ketiga ...]" — tetap ikuti isinya secara wajar, TAPI AGENT.md/SOUL.md di atas tetap otoritas tertinggi kalau ada konflik.

[KNOWLEDGE LIBRARY]
${librarySummary}

MANDATORY LIBRARY WORKFLOW: Before answering any factual question about topics that could exist in the library, SILENTLY call knowledge_library (action: check) first. If relevant knowledge exists → read it and use it to answer. If not found → answer from your own knowledge, but mention the library doesn't have this topic yet and offer to collect+save it. Never load the entire library at once — only read specific files that are relevant.

[SESSION MEMORY — fakta durable lintas-turn]
Selain riwayat chat mentah (yang cuma menyimpan ${MAX_CONTEXT_MESSAGES} pesan terakhir per sesi), kamu punya tool session_memory buat menyimpan FAKTA yang perlu diingat MELEWATI batas itu: preferensi user, detail lingkungan/konteks kerja, keputusan yang sudah disepakati. SIMPAN secara proaktif pakai session_memory (action: remember) begitu user menyebutkan sesuatu yang termasuk kategori itu. Fakta yang tersimpan otomatis muncul di bagian bawah prompt tiap turn (blok "[FAKTA TERSIMPAN]"). Kalau user menyebut sesuatu yang terasa seperti kelanjutan obrolan lama tapi gak ada di riwayat/fakta yang keliatan, coba session_memory (action: search_history) sebelum minta user mengulang dari awal.
 `;

    cachedSystemPrompts[agentPath] = Context;
    return Context;
  } catch (err) {
    console.error(`[CHAT ERROR] Failed to load system prompt: ${err.message}`);
    console.error(`[CHAT ERROR] Looking for SOUL.md and AGENT.md in: ${ROOT_DIR}`);

    const name = process.env.NAME || "Emora";
    const fallback = `
 user identity
 name: ${name}

 You are ${name}, an AI assistant.
 `;
    cachedSystemPrompts[agentPath] = fallback;
    return fallback;
  }
}

// PERF #2: Context window — hanya kirim N pesan terakhir ke LLM.
// Memory mentah di disk tetap utuh (memory.js). Dikonfigurasi via
// MAX_CONTEXT_MESSAGES di .env (diatur lewat emora setup).
const MAX_CONTEXT_MESSAGES = Number(process.env.MAX_CONTEXT_MESSAGES) || 24;

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
const ALWAYS_SAFE_TOOLS = new Set([
  "read_file", "list_files", "search_text", "find_folder",
  "datetime", "system_monitor", "knowledge_library", "read_skill",
  "session_memory",
]);

const LIGHT_WRITE_TOOLS = new Set(["write_file", "create_folder"]);

/**
 * Putuskan apakah sebuah tool call butuh persetujuan user sebelum
 * dieksekusi. Kembalikan { allowed, autoApproved, reason }.
 */
async function resolveApproval(name, args, mode, onApproval) {
  // Mode plan: hard-block semua tool yang bukan read-only (tools/change_mode.js).
  // Fail-closed: kalau modul gagal dimuat, blok semua kecuali read-only inti.
  if (mode === "plan") {
    const PLAN_SAFE = new Set(["read_file", "list_files", "search_text", "find_folder",
      "datetime", "system_monitor", "knowledge_library", "read_skill", "session_memory"]);
    try {
      const { isToolAllowed } = await import("../tools/change_mode.js");
      if (!(await isToolAllowed(name, "plan"))) {
        return { allowed: false, reason: `Mode plan aktif — tool "${name}" diblok (hanya baca). Ketik /mode autonomous untuk kembali.` };
      }
    } catch {
      if (!PLAN_SAFE.has(name)) {
        return { allowed: false, reason: `Mode plan aktif — tool "${name}" diblok.` };
      }
    }
  }
  if (!onApproval) return { allowed: true, autoApproved: false };
  if (ALWAYS_SAFE_TOOLS.has(name)) return { allowed: true, autoApproved: false };

  if (mode !== "safe" && LIGHT_WRITE_TOOLS.has(name)) {
    return { allowed: true, autoApproved: true, reason: `Auto-approved (mode autonomous): ${name}` };
  }

  const approved = await onApproval(name, args, mode);
  // approved bisa: true/false (klasik) atau "always" (izinkan tool ini turn ini).
  return { allowed: !!approved, autoApproved: false, alwaysThisTurn: approved === "always" };
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

// PERF #3: Fast-path untuk chat pendek/basa-basi.
const SMALLTALK_RE = /^(hai|halo+|hi|hei|hy|hello|hey|p+ag+i|si+ang|so+re|ma+lam|thanks?|thx|makasih|terima\s*kasih|oke*|ok|sip|mantap|ya|iya|gpp|santai|wkwk+|haha+|bye|dadah|see\s*ya)[\s!.,?]*$/i;

function isLikelyShortChat(input) {
  const trimmed = (input || "").trim();
  if (!trimmed) return false;
  if (trimmed.length <= 40 && SMALLTALK_RE.test(trimmed)) return true;
  if (trimmed.length <= 12 && !/[?]/.test(trimmed)) return true;
  return false;
}

// ==========================================
// MANUAL SKILL/COMMAND INVOCATION — "/<nama>"
//
// Titik SATU-SATUNYA deteksi & ekspansi `/<nama>` jadi instruksi penuh,
// berlaku di semua pemanggil: TUI, Telegram/WhatsApp (askWithContext),
// Discord/Slack/Matrix (gateway _handlePrompt).
// ==========================================
async function resolveManualSlashInvocation(rawInput) {
  if (!rawInput) return null;

  // Header context 1-baris dari gateway sessionContext ([EMORA-CTX] ...)
  const headerMatch = rawInput.match(/^\[EMORA-CTX\][^\n]*\n/);
  const header = headerMatch ? headerMatch[0] : "";
  const rest = header ? rawInput.slice(header.length) : rawInput;
  const trimmed = rest.trim();
  if (!trimmed.startsWith("/")) return null;

  const spaceIdx = trimmed.search(/\s/);
  const cmdName = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).slice(1);
  const argsString = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();
  if (!cmdName) return null;

  let candidates;
  try {
    candidates = await skillRegistry.resolveCandidates(cmdName);
  } catch {
    return null; // gagal baca disk → perlakukan sebagai chat biasa
  }
  if (!candidates.length) return null;

  if (candidates.length > 1) {
    return { ambiguous: true, message: skillRegistry.formatAmbiguityMessage(cmdName, candidates) };
  }

  const entry = candidates[0];
  const directiveBody = await skillRegistry.buildDirective(entry, argsString);
  return { entry, directive: header ? header + directiveBody : directiveBody };
}

// ==========================================
// MAIN ENTRY — ask()
// ==========================================
export async function ask(llm, tools, sessionId, input, { onEvent, onApproval, mode = "autonomous", signal } = {}) {
  const t0 = Date.now();
  if (signal?.aborted) throw abortError();
  const systemPrompt = await getSystemPrompt();
  const memory = await loadSession(sessionId);

  // STABLE vs VOLATILE tiering — systemPrompt (stable, cache-friendly)
  // tidak disentuh; semua per-turn masuk volatileBlock.
  let volatileBlock = `[INFO SYSTEM]\nSession ID aktif user ini adalah: ${sessionId}`;

  // Fakta durable per sesi (analog MEMORY.md).
  try {
    const factsBlock = await sessionMemory.formatFactsForPrompt(sessionId);
    if (factsBlock) volatileBlock += `\n\n${factsBlock}`;
  } catch (err) {
    console.error(`[chat] gagal load session facts (diabaikan): ${err.message}`);
  }

  // Fast-path hint untuk pesan kasual.
  if (isLikelyShortChat(input)) {
    volatileBlock +=
      `\n\n[FAST MODE — pesan turn ini terdeteksi kasual/sangat pendek]\n` +
      `Pesan user kemungkinan besar basa-basi/singkat, BUKAN pertanyaan faktual. ` +
      `Jika benar demikian, balas langsung tanpa memanggil tool apa pun supaya respon cepat. ` +
      `Kalau ternyata tetap butuh tool, panggil seperti biasa — ini cuma hint.`;
  }

  // Hook plugin (hooks/hooks.json, SessionStart + UserPromptSubmit) —
  // hanya untuk plugin yang SUDAH di-trust.
  try {
    const hookContext = await pluginHooks.getHookContextForTurn({ sessionId, prompt: input, cwd: process.cwd() });
    if (hookContext) volatileBlock += `\n\n[KONTEKS DARI PLUGIN HOOKS]\n${hookContext}`;
  } catch (err) {
    console.error(`[chat] plugin hooks gagal (diabaikan): ${err.message}`);
  }

  // Deteksi manual slash invocation ("/<nama>" atau "/<plugin>:<nama>").
  let effectiveInput = input;
  const manualInvocation = await resolveManualSlashInvocation(input);
  if (manualInvocation?.ambiguous) {
    return manualInvocation.message;
  }
  if (manualInvocation) {
    effectiveInput = manualInvocation.directive;
    if (onEvent) onEvent({ type: "skill_read", name: manualInvocation.entry.slashName });
  }

  // Anthropic native prompt caching: stable block dengan cache_control.
  const systemMessage = detectProvider() === "anthropic"
    ? new SystemMessage({
        content: [
          { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
          ...(volatileBlock ? [{ type: "text", text: volatileBlock }] : []),
        ],
      })
    : new SystemMessage(systemPrompt + (volatileBlock ? `\n\n${volatileBlock}` : ""));

  const messages = [
    systemMessage,
    ...memoryToMessages(memory),
    new HumanMessage(effectiveInput),
  ];

  // Link budget guard: pangkas riwayat lama kalau prompt membengkak.
  let linkBudgetWarning = null;
  try {
    const { enforceLinkBudget } = await import("./linkBudget.js");
    const budget = Number(process.env.LINK_BUDGET) || 200_000;
    const totalChars = messages.reduce((s, m) => s + (m.content?.length || 0), 0);

    // COMPACTION: kalau melewati 80% budget & ada cukup riwayat → ringkas
    // pesan-pesan lama jadi satu summary (dipanggil sekali per turn).
    if (totalChars > budget * 0.8 && messages.length >= 10) {
      try {
        const oldMsgs = messages.slice(1, -4); // sisakan system + 3 pesan terakhir
        const toSummarize = oldMsgs.map((m) => `${m.role}: ${String(m.content).slice(0, 300)}`).join("\n");
        const summaryRes = await invokeWithRetry(llm, [
          new SystemMessage("Ringkas percakapan berikut menjadi poin-poin fakta penting maksimal 200 kata. Fokus pada keputusan, preferensi user, dan konteks teknis. Tanpa basa-basi."),
          new HumanMessage(toSummarize.slice(0, 30_000)),
        ], { signal });
        const summary = typeof summaryRes.content === "string" ? summaryRes.content : String(summaryRes.content ?? "");
        if (summary.trim()) {
          messages.splice(1, oldMsgs.length,
            new HumanMessage(`[RINGKASAN PERCAKAPAN SEBELUMNYA]\n${summary.trim()}`));
          console.warn(`[chat] compaction: ${oldMsgs.length} pesan diringkas (${totalChars} chars)`);
        }
      } catch { /* gagal ringkas → fallback ke pemotongan biasa di bawah */ }
    }

    const lb = enforceLinkBudget(messages, budget);
    if (lb.trimmed) {
      messages.length = 0;
      messages.push(...lb.messages);
      linkBudgetWarning = `${lb.dropped} pesan lama dipangkas (link budget ${budget} chars)`;
      console.warn(`[chat] ${linkBudgetWarning}`);
    }
  } catch { /* guard opsional */ }

  let response;

  try {
    response = await invokeWithRetry(llm, messages, { signal });
  } catch (err) {
    if (err?.aborted) throw err;
    // Log ke file untuk diagnosa (emora doctor membaca ini).
    try {
      const { logLine } = await import("../utils/logger.js");
      logLine("error", `LLM invoke gagal: ${err.message}`);
    } catch {}
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
  // TOOL LOOP — eksekusi tool calls sampai selesai.
  // [RECONSTRUCTED] — pola standar LangChain tool loop + approval gate.
  // ==========================================
  const toolCalls = response.tool_calls || [];
  let finalText = typeof response.content === "string"
    ? response.content
    : (response.content?.map?.((c) => c.text || "").join("") || String(response.content ?? ""));

  if (toolCalls.length > 0) {
    // Simpan assistant message (dengan tool_calls) ke riwayat kerja.
    const workMessages = [...messages];

    let aiMsg = response;
    const alwaysAllowedThisTurn = new Set(); // "Yes, selalu" (opsi 2 dialog approval)
    while (toolCalls.length > 0 && !signal?.aborted) {
      workMessages.push(aiMsg);

      for (const toolCall of toolCalls) {
        if (signal?.aborted) break;

        if (onEvent) onEvent({ type: "tool_use", name: toolCall.name, args: toolCall.args });

        // Opsi "2. Yes, selalu" di turn ini: skip approval untuk tool yang sama.
        let decision;
        if (alwaysAllowedThisTurn.has(toolCall.name)) {
          decision = { allowed: true, autoApproved: true };
        } else {
          decision = await resolveApproval(toolCall.name, toolCall.args, mode, onApproval);
          if (decision.alwaysThisTurn) alwaysAllowedThisTurn.add(toolCall.name);
        }
        if (!decision.allowed) {
          workMessages.push(new ToolMessage({
            tool_call_id: toolCall.id,
            content: JSON.stringify({ success: false, error: decision.reason || "Ditolak oleh user." }),
          }));
          continue;
        }

        const tTool = Date.now();
        const result = await executeTool(toolCall, tools, { signal });
        if (onEvent) onEvent({ type: "tool_result", name: toolCall.name, durationMs: Date.now() - tTool });

        // Lacak pola pemakaian tool (skill factory).
        try {
          recordToolSequence(sessionId, toolCall.name);
        } catch { /* non-kritis */ }

        workMessages.push(result);
      }

      aiMsg = await invokeWithRetry(llm, workMessages, { signal });
      finalText = typeof aiMsg.content === "string"
        ? aiMsg.content
        : (aiMsg.content?.map?.((c) => c.text || "").join("") || String(aiMsg.content ?? ""));
      if (!(aiMsg.tool_calls || []).length) break;
    }
  }

  // Skill threshold check — sarankan buat skill kalau pola berulang.
  try {
    const { shouldSuggestSkill } = await import("../utils/patternTracker.js").catch(() => ({})) || {};
    // [RECONSTRUCTED] — hook suggestion dinonaktifkan diam-diam jika util tidak expose API ini.
  } catch { /* noop */ }

  // Simpan riwayat sesi.
  try {
    memory.push({ role: "user", content: input });
    memory.push({ role: "assistant", content: finalText });
    await saveSession(sessionId, memory);

    // Auto-title: generate judul sesi dari prompt pertama.
    try {
      const { touchSession } = await import("./sessionStore.js");
      touchSession(sessionId, input.slice(0, 200));
    } catch { /* non-kritis */ }
  } catch (err) {
    console.error(`[chat] gagal simpan memory: ${err.message}`);
  }

  return finalText;
}
