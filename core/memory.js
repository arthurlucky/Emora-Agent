import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MEMORY_DIR = process.env.EMORA_MEMORY_DIR || path.join(__dirname, '..', 'memory');

// Pastikan folder memory ada
import fsSync from 'fs';
if (!fsSync.existsSync(MEMORY_DIR)) {
  fsSync.mkdirSync(MEMORY_DIR, { recursive: true });
}

// ==========================================
// PERF #1: In-memory cache per sessionId.
// Sebelumnya setiap panggilan ask() melakukan disk read penuh
// (readFile + JSON.parse) sebelum bisa membalas — di sesi yang chat-nya
// beruntun (kasus paling umum), itu I/O yang terbuang karena isinya sama
// dengan yang baru saja kita simpan sendiri sebelumnya. Cache ini membuat
// sesi yang sedang "hangat" (baru dipakai) langsung terbaca dari RAM,
// menghilangkan 1 disk read + JSON.parse di setiap turn chat.
// ==========================================
const sessionCache = new Map(); // sessionId -> { data: messages[], timestamp: number }
const MAX_CACHE_SESSIONS = 50; // batas ramah perangkat seluler (Termux)
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 menit
const MAX_MESSAGES_PER_SESSION = 500;

function touchCache(sessionId, data) {
  sessionCache.delete(sessionId);
  sessionCache.set(sessionId, { data, timestamp: Date.now() });
  
  // Evict entry tertua jika melebihi batas
  if (sessionCache.size > MAX_CACHE_SESSIONS) {
    const oldestKey = sessionCache.keys().next().value;
    sessionCache.delete(oldestKey);
  }
}

export async function loadSession(sessionId) {
  const cached = sessionCache.get(sessionId);
  if (cached) {
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return [...cached.data];
    }
    sessionCache.delete(sessionId);
  }

  try {
    const file = path.join(MEMORY_DIR, `${sessionId}.json`);
    const content = await fs.readFile(file, "utf8");
    const data = JSON.parse(content);
    touchCache(sessionId, data);
    return [...data];
  } catch {
    return [];
  }
}

export async function saveSession(sessionId, messages) {
  const trimmed = messages.length > MAX_MESSAGES_PER_SESSION 
    ? messages.slice(-MAX_MESSAGES_PER_SESSION) 
    : messages;

  touchCache(sessionId, trimmed);

  const file = path.join(MEMORY_DIR, `${sessionId}.json`);
  const tmp = file + '.tmp';
  await fs.writeFile(
    tmp,
    JSON.stringify(trimmed, null, 2)
  );
  await fs.rename(tmp, file);
}

/**
 * Hapus entry sebuah sesi dari cache (dipanggil sessionStore.js setelah
 * deleteSession, supaya cache tidak menyimpan data basi/stale).
 */
export function invalidateSessionCache(sessionId) {
  sessionCache.delete(sessionId);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, cached] of sessionCache.entries()) {
    if (now - cached.timestamp >= CACHE_TTL_MS) {
      sessionCache.delete(id);
    }
  }
}, 5 * 60 * 1000).unref();
