/**
 * core/sessionStore.js
 *
 * Lapisan tipis di atas core/memory.js untuk mengelola SESI CHAT sebagai
 * entitas: daftar, nama custom, dibuat, dihapus, diganti nama.
 *
 * core/memory.js menyimpan riwayat percakapan mentah per sessionId di
 * memory/<sessionId>.json. File itu sendiri tidak punya "nama" — UUID-nya
 * lah satu-satunya identitas. Module ini menambahkan file metadata
 * (memory/sessions.meta.json) yang memetakan sessionId -> { name, createdAt,
 * updatedAt } supaya Web UI bisa menampilkan nama yang manusiawi dan
 * mengurutkan sesi berdasarkan aktivitas terakhir.
 *
 * Sesi yang dibuat dari CLI/Telegram/WhatsApp (yang tidak lewat module ini)
 * tetap muncul di listSessions() — kalau belum ada metadata-nya, nama
 * default dibuat otomatis dari potongan UUID-nya.
 */

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const MEMORY_DIR = path.resolve("./memory");
const META_FILE = path.join(MEMORY_DIR, "sessions.meta.json");

// UUID v4 standar — dipakai untuk memfilter file yang benar-benar sesi utama
// (bukan file metadata, dan bukan sesi background task yang formatnya
// "<uuid>_bg_<job_id>").
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ensureMemoryDir() {
  await fs.mkdir(MEMORY_DIR, { recursive: true });
}

async function loadMeta() {
  try {
    const raw = await fs.readFile(META_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveMeta(meta) {
  await ensureMemoryDir();
  await fs.writeFile(META_FILE, JSON.stringify(meta, null, 2));
}

function defaultName(sessionId) {
  return `Sesi ${sessionId.slice(0, 8)}`;
}

/**
 * Daftar semua sesi utama (bukan sub-sesi background task), digabung
 * dengan metadata nama & diurutkan dari yang paling baru diaktivitas.
 */
export async function listSessions() {
  await ensureMemoryDir();

  const files = await fs.readdir(MEMORY_DIR).catch(() => []);
  const meta = await loadMeta();

  const sessions = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const id = file.replace(/\.json$/, "");
    if (!UUID_RE.test(id)) continue; // skip metadata file & sesi background

    const filePath = path.join(MEMORY_DIR, file);
    let messageCount = 0;
    let stat;
    try {
      stat = await fs.stat(filePath);
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw || "[]");
      messageCount = Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      stat = null;
    }

    const m = meta[id] || {};
    sessions.push({
      id,
      name: m.name || defaultName(id),
      createdAt: m.createdAt || stat?.birthtimeMs || stat?.mtimeMs || Date.now(),
      updatedAt: m.updatedAt || stat?.mtimeMs || Date.now(),
      messageCount,
    });
  }

  // Sesi yang sudah punya metadata tapi file riwayatnya belum pernah
  // ditulis (baru saja dibuat, belum ada chat sama sekali) tetap muncul.
  for (const id of Object.keys(meta)) {
    if (sessions.find((s) => s.id === id)) continue;
    sessions.push({
      id,
      name: meta[id].name || defaultName(id),
      createdAt: meta[id].createdAt || Date.now(),
      updatedAt: meta[id].updatedAt || meta[id].createdAt || Date.now(),
      messageCount: 0,
    });
  }

  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  return sessions;
}

/**
 * Buat sesi baru. Tidak menulis file memory/<id>.json — file itu otomatis
 * tercipta saat pesan pertama dikirim (lihat core/memory.js saveSession).
 */
export async function createSession(name) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const meta = await loadMeta();

  meta[id] = {
    name: (name || "").trim() || defaultName(id),
    createdAt: now,
    updatedAt: now,
  };

  await saveMeta(meta);
  return { id, name: meta[id].name, createdAt: now, updatedAt: now, messageCount: 0 };
}

/**
 * Ganti nama sesi. Bekerja juga untuk sesi yang belum punya entry metadata
 * (mis. sesi lama dari CLI) — entry baru otomatis dibuat.
 */
export async function renameSession(id, name) {
  if (!UUID_RE.test(id)) throw new Error("Session ID tidak valid.");
  const trimmed = (name || "").trim();
  if (!trimmed) throw new Error("Nama sesi tidak boleh kosong.");

  const meta = await loadMeta();
  const now = Date.now();

  meta[id] = {
    name: trimmed,
    createdAt: meta[id]?.createdAt || now,
    updatedAt: now,
  };

  await saveMeta(meta);
  return meta[id];
}

/**
 * Hapus sesi: file riwayat percakapan + entry metadata-nya.
 * Sub-sesi background task terkait (id_bg_*) ikut dibersihkan.
 */
export async function deleteSession(id) {
  if (!UUID_RE.test(id)) throw new Error("Session ID tidak valid.");

  const files = await fs.readdir(MEMORY_DIR).catch(() => []);
  let deletedFiles = 0;

  for (const file of files) {
    if (file === `${id}.json` || file.startsWith(`${id}_bg_`)) {
      await fs.unlink(path.join(MEMORY_DIR, file)).catch(() => {});
      deletedFiles++;
    }
  }

  const meta = await loadMeta();
  if (meta[id]) {
    delete meta[id];
    await saveMeta(meta);
  }

  return { deletedFiles };
}

/**
 * Tandai sesi sebagai baru saja aktif (dipanggil setelah chat berhasil)
 * supaya urutan daftar sesi mengikuti aktivitas terbaru meskipun sesi
 * tersebut dibuat dari channel lain (CLI/Telegram/WA) tanpa lewat
 * createSession().
 */
export async function touchSession(id) {
  if (!UUID_RE.test(id)) return;
  const meta = await loadMeta();
  const now = Date.now();

  meta[id] = {
    name: meta[id]?.name || defaultName(id),
    createdAt: meta[id]?.createdAt || now,
    updatedAt: now,
  };

  await saveMeta(meta);
}

export async function getSession(id) {
  const sessions = await listSessions();
  return sessions.find((s) => s.id === id) || null;
}
