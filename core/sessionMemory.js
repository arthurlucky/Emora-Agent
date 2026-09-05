/**
 * core/sessionMemory.js
 *
 * EMORA sebelumnya cuma punya SATU lapisan memori: riwayat mentah per
 * sesi (memory/<sessionId>.json), dipotong ke MAX_CONTEXT_MESSAGES pesan
 * terakhir tiap turn (lihat memoryToMessages di core/chat.js) — begitu
 * sebuah fakta "kegeser" keluar window itu, HILANG PERMANEN, gak ada
 * jejak sama sekali, dan gak ada cara sama sekali buat nemu balik
 * percakapan lama sesi lain. Itu arsitektur yang genuinely ketinggalan
 * dibanding agent modern (Hermes Agent, Claude Code, dst).
 *
 * Modul ini nambahin DUA hal yang Hermes Agent punya dan EMORA sebelumnya
 * gak punya sama sekali:
 *
 *   1. FAKTA DURABLE per sesi (analog MEMORY.md/USER.md Hermes) — agent
 *      PROAKTIF nyimpen fakta yang "kemungkinan besar masih relevan puluhan
 *      turn ke depan" (preferensi user, keputusan yang disepakati, detail
 *      konteks kerja) lewat tool session_memory (action: remember). Fakta
 *      ini TIDAK ikut kena window-cut — selalu disuntik ke system prompt
 *      TIAP TURN selama sesi itu masih berjalan, terlepas riwayat mentahnya
 *      sudah kegeser atau belum. Disimpan terpisah dari riwayat mentah:
 *      memory/<sessionId>.facts.json — supaya SEDIKIT & padat (bukan
 *      transkrip penuh), sesuai prinsip Hermes: "keep it compact and
 *      focused on facts that will still matter later."
 *
 *   2. SESSION SEARCH (analog session_search Hermes) — kemampuan agent
 *      mencari SEMUA sesi lain (bukan cuma sesi yang sedang jalan) kalau
 *      user menyebut sesuatu yang terasa seperti kelanjutan obrolan lama.
 *      Implementasinya sengaja sederhana (keyword/substring scoring, bukan
 *      embedding/vector search) — cukup buat "nemu balik", bukan RAG
 *      semantik penuh (itu peran knowledge_library yang memang beda tujuan:
 *      pengetahuan umum lintas-topik, bukan riwayat obrolan personal).
 */

import fs from "fs/promises";
import fsSync from "fs";
import path from "path";

const MEMORY_DIR = process.env.EMORA_MEMORY_DIR ? path.resolve(process.env.EMORA_MEMORY_DIR) : path.resolve("./memory");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ── Lightweight Search Index ─────────────────────────────────────────
// Maps keyword → Set<sessionId> untuk avoid full-scan saat searchHistory().
let searchIndex = null; // lazy init
const STOP_WORDS = new Set(["yang", "dan", "ini", "itu", "ada", "untuk", "dengan", "dari", "pada", "tidak", "the", "and", "for", "this", "that", "with", "from"]);

function extractKeywords(text) {
  if (!text || typeof text !== "string") return [];
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

async function ensureSearchIndex() {
  if (searchIndex) return searchIndex;
  searchIndex = new Map();
  
  let files;
  try {
    files = await fs.readdir(MEMORY_DIR);
  } catch { return searchIndex; }
  
  for (const file of files) {
    if (!file.endsWith(".json") || file.endsWith(".facts.json") || file === "sessions.meta.json") continue;
    const sessionId = file.replace(/\.json$/, "");
    try {
      const raw = await fs.readFile(path.join(MEMORY_DIR, file), "utf8");
      const messages = JSON.parse(raw);
      if (!Array.isArray(messages)) continue;
      const allText = messages.map(m => m.content || "").join(" ");
      for (const kw of extractKeywords(allText)) {
        if (!searchIndex.has(kw)) searchIndex.set(kw, new Set());
        searchIndex.get(kw).add(sessionId);
      }
    } catch { continue; }
  }
  return searchIndex;
}

/** Call after saving a session to keep index up-to-date. */
export function updateSearchIndex(sessionId, messages) {
  if (!searchIndex) return; // not built yet, will be built lazily
  const allText = messages.map(m => (m.content || "")).join(" ");
  for (const kw of extractKeywords(allText)) {
    if (!searchIndex.has(kw)) searchIndex.set(kw, new Set());
    searchIndex.get(kw).add(sessionId);
  }
}

export function invalidateSearchIndex() {
  searchIndex = null;
}

function factsPath(sessionId) {
  return path.join(MEMORY_DIR, `${sessionId}.facts.json`);
}

async function readFacts(sessionId) {
  try {
    const raw = await fs.readFile(factsPath(sessionId), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeFacts(sessionId, facts) {
  if (!fsSync.existsSync(MEMORY_DIR)) fsSync.mkdirSync(MEMORY_DIR, { recursive: true });
  await fs.writeFile(factsPath(sessionId), JSON.stringify(facts, null, 2));
}

const MAX_FACTS_PER_SESSION = 40; // batas wajar biar tetap "padat", bukan jadi transkrip kedua

/** Simpan 1 fakta baru. Dedup sederhana (exact-match) biar gak numpuk duplikat. */
export async function rememberFact(sessionId, fact) {
  const trimmed = (fact || "").trim();
  if (!trimmed) return { ok: false, error: "Fakta kosong" };

  const facts = await readFacts(sessionId);
  if (facts.some((f) => f.fact.toLowerCase() === trimmed.toLowerCase())) {
    return { ok: true, deduped: true, total: facts.length };
  }

  facts.push({ fact: trimmed, savedAt: Date.now() });
  // FIFO kalau kepenuhan — fakta TERLAMA yang dibuang duluan, konsisten
  // dengan gagasan "recency matters" yang sama dipakai window riwayat mentah.
  while (facts.length > MAX_FACTS_PER_SESSION) facts.shift();

  await writeFacts(sessionId, facts);
  return { ok: true, deduped: false, total: facts.length };
}

export async function listFacts(sessionId) {
  return readFacts(sessionId);
}

export async function forgetFact(sessionId, factText) {
  const facts = await readFacts(sessionId);
  const target = (factText || "").trim().toLowerCase();
  const filtered = facts.filter((f) => f.fact.toLowerCase() !== target);
  const removed = filtered.length !== facts.length;
  if (removed) await writeFacts(sessionId, filtered);
  return { ok: true, removed };
}

/**
 * Format fakta tersimpan jadi blok siap suntik ke system prompt (dipanggil
 * dari core/chat.js `ask()` tiap turn — TIER VOLATILE, bukan cached,
 * karena isinya bisa berubah kapan saja selama sesi berjalan).
 */
export async function formatFactsForPrompt(sessionId) {
  const facts = await listFacts(sessionId);
  if (!facts.length) return "";
  const lines = facts.map((f) => `- ${f.fact}`).join("\n");
  return `[FAKTA TERSIMPAN — sesi ini]\n${lines}`;
}

/**
 * session_search: cari lintas SEMUA sesi (kecuali sesi yang sedang
 * berjalan, opsional) buat keyword/frasa tertentu. Scoring sederhana:
 * jumlah kemunculan kata kunci (case-insensitive) di tiap pesan, sesi
 * dengan skor tertinggi & pesan paling relevan yang dikembalikan sebagai
 * cuplikan pendek + info sesi. Bukan vector search — cukup buat "coba
 * inget-inget", bukan pencarian semantik penuh.
 */
export async function searchHistory(query, { excludeSessionId = null, limit = 5 } = {}) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return [];
  const keywords = q.split(/\s+/).filter((w) => w.length > 2);
  if (!keywords.length) return [];

  // Use index to find candidate sessions instead of scanning ALL files
  const idx = await ensureSearchIndex();
  const candidateSessions = new Map(); // sessionId → score (number of keyword hits in index)
  for (const kw of keywords) {
    const sessions = idx.get(kw);
    if (!sessions) continue;
    for (const sid of sessions) {
      if (excludeSessionId && sid === excludeSessionId) continue;
      candidateSessions.set(sid, (candidateSessions.get(sid) || 0) + 1);
    }
  }

  if (candidateSessions.size === 0) return [];

  // Sort candidates by index score, take top N*2 to read (not all)
  const topCandidates = [...candidateSessions.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit * 2)
    .map(([sid]) => sid);

  let meta = {};
  try {
    meta = JSON.parse(await fs.readFile(path.join(MEMORY_DIR, "sessions.meta.json"), "utf8"));
  } catch { /* metadata opsional */ }

  const results = [];
  for (const sessionId of topCandidates) {
    let messages;
    try {
      messages = JSON.parse(await fs.readFile(path.join(MEMORY_DIR, `${sessionId}.json`), "utf8"));
      if (!Array.isArray(messages)) continue;
    } catch { continue; }

    let bestScore = 0;
    let bestMsg = null;
    for (const m of messages) {
      const content = (m.content || "").toLowerCase();
      if (!content) continue;
      const score = keywords.reduce((acc, kw) => acc + (content.includes(kw) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        bestMsg = m;
      }
    }

    if (bestScore > 0 && bestMsg) {
      const excerptRaw = bestMsg.content.length > 220 ? bestMsg.content.slice(0, 220) + "..." : bestMsg.content;
      results.push({
        sessionId,
        title: meta[sessionId]?.name || `Sesi ${sessionId.slice(0, 8)}`,
        score: bestScore,
        role: bestMsg.role,
        excerpt: excerptRaw,
        timestamp: bestMsg.timestamp || null,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/**
 * Semantic Memory Compaction (Feature #5):
 * Ekstrak fakta-fakta penting dari riwayat pesan lalu simpan secara durabel ke sessionMemory.
 */
export async function extractSemanticFacts(sessionId, messages, llm) {
  if (!sessionId || !messages || messages.length < 3 || !llm) return;
  try {
    const { SystemMessage, HumanMessage } = await import("@langchain/core/messages");
    const toAnalyze = messages
      .map((m) => `${m.role || m._getType?.() || "msg"}: ${String(m.content).slice(0, 300)}`)
      .join("\n");

    const prompt = [
      new SystemMessage(
        "Tugas Anda: Ekstrak fakta penting (preferensi user, keputusan teknis, detail proyek, aturan yang disepakati) dari percakapan berikut. " +
        "Kembalikan HANYA JSON array string, contoh: [\"User suka warna biru\", \"Project menggunakan React\"]. Jika tidak ada fakta baru, kembalikan []."
      ),
      new HumanMessage(toAnalyze.slice(0, 15_000)),
    ];

    const res = await llm.invoke(prompt);
    const content = typeof res.content === "string" ? res.content : String(res.content ?? "");
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const facts = JSON.parse(jsonMatch[0]);
      if (Array.isArray(facts)) {
        for (const fact of facts) {
          if (typeof fact === "string" && fact.trim() && fact.trim().length > 3) {
            await rememberFact(sessionId, fact.trim());
          }
        }
      }
    }
  } catch (err) {
    console.error(`[sessionMemory] extractSemanticFacts error (diabaikan): ${err.message}`);
  }
}

export default { rememberFact, listFacts, forgetFact, formatFactsForPrompt, searchHistory, extractSemanticFacts, updateSearchIndex, invalidateSearchIndex };
