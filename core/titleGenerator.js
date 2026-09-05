/**
 * core/titleGenerator.js
 *
 * Stage-2 title upgrade ala Hermes (title_generator.generate_title):
 *   - Satu panggilan LLM kecil, JSON-only, no preamble, fire-and-forget.
 *   - Hanya replace judul yang masih "derived" (auto) — judul user manual
 *     tidak pernah ditimpa (provenance: derived < llm < user).
 *   - Gagal = diam; judul stage-1 tetap dipakai.
 */

import { touchSession } from "./sessionStore.js";

const MAX_CHARS = 80;

/** Ambil metadata sesi, return {name, source} kalau sudah ada, else null. */
async function getCurrentMeta(sessionId) {
  try {
    const { loadMeta, saveMeta } = await import("./sessionStore.js");
    // Pakai internal lewat dynamic import — loadMeta tidak di-export default
    // di sessionStore.js, jadi kita gunakan touchSession sebagai proxy: ia
    // selalu load meta saat jalan.
    const fs = await import("fs/promises");
    const path = await import("path");
    const MEMORY_DIR = process.env.EMORA_MEMORY_DIR || "./memory";
    const metaFile = path.resolve(MEMORY_DIR, "sessions.meta.json");
    try {
      const raw = await fs.readFile(metaFile, "utf8");
      const meta = JSON.parse(raw);
      return meta[sessionId] || null;
    } catch { return null; }
  } catch { return null; }
}

/** Set nama sesi (level "llm") — tidak menimpa kalau sudah "user". */
async function setTitleLlm(sessionId, title) {
  if (!title || title.length < 2) return false;
  const clean = title
    .replace(/^title:\s*/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;]+$/, "");
  if (!clean) return false;
  const final = clean.length > MAX_CHARS ? clean.slice(0, MAX_CHARS - 1) + "…" : clean;

  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const MEMORY_DIR = process.env.EMORA_MEMORY_DIR || "./memory";
    const metaFile = path.resolve(MEMORY_DIR, "sessions.meta.json");
    let meta = {};
    try { meta = JSON.parse(await fs.readFile(metaFile, "utf8")); } catch { meta = {}; }
    const cur = meta[sessionId];
    // Provenance guard: hanya replace kalau masih default/derived (bukan user-set).
    if (cur?.source === "user") return false;
    if (cur?.name === final) return false;
    meta[sessionId] = {
      ...(cur || {}),
      name: final,
      source: "llm",
      updatedAt: Date.now(),
    };
    await fs.mkdir(path.dirname(metaFile), { recursive: true });
    await fs.writeFile(metaFile, JSON.stringify(meta, null, 2));
    return true;
  } catch { return false; }
}

/** Panggil LLM untuk upgrade judul. Timeout 8s, JSON-only. */
export async function upgradeTitle({ sessionId, llm, userMessage }) {
  if (!sessionId || !llm || !userMessage) return;
  // Skip pesan pendek/basa-basi.
  const trimmed = userMessage.trim();
  if (trimmed.length < 4) return;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const res = await llm.invoke([
      {
        role: "system",
        content: 'You name chat sessions. Given the user\'s opening message, write a SHORT title (3-7 words) capturing what they want done. Reply with ONLY a JSON object: {"title": "..."}. No preamble.',
      },
      { role: "user", content: `Opening message (max 1000 chars):\n${trimmed.slice(0, 1000)}` },
    ], { signal: controller.signal }).finally(() => clearTimeout(timer));

    const txt = (typeof res?.content === "string" ? res.content : String(res?.content || "")).trim();
    const m = txt.match(/\{[\s\S]*?"title"\s*:\s*"([^"]+)"/i);
    if (!m) return;
    await setTitleLlm(sessionId, m[1].trim());
  } catch { /* gagal upgrade = judul instant tetap dipakai */ }
}
