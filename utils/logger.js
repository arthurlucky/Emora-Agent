/**
 * utils/logger.js — File logger sederhana dengan rotasi.
 *
 * Log ke .emora/logs/emora.log. Rotasi: >5MB → rename ke emora.log.1
 * (maks 3 generik, yang tertua terhapus). Dipakai untuk error/warn penting
 * sehingga `emora doctor` bisa menampilkan riwayat masalah.
 *
 * ponytail: append-only tanpa level filter — cukup untuk skala single-user.
 */
import fsSync from "fs";
import path from "path";

const LOG_DIR = ".emora/logs";
const LOG_FILE = path.join(LOG_DIR, "emora.log");
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROTATE = 3;

function ensureDir() {
  try { fsSync.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
}

function rotateIfNeeded() {
  try {
    if (!fsSync.existsSync(LOG_FILE)) return;
    const size = fsSync.statSync(LOG_FILE).size;
    if (size < MAX_BYTES) return;
    // Geser: .2 → .3, .1 → .2, current → .1
    for (let i = MAX_ROTATE - 1; i >= 1; i--) {
      const from = `${LOG_FILE}.${i}`;
      const to = `${LOG_FILE}.${i + 1}`;
      if (fsSync.existsSync(from)) fsSync.renameSync(from, to);
    }
    fsSync.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch { /* rotasi gagal — jangan sampai logging bikin crash */ }
}

/**
 * Tulis satu baris log. level: "error" | "warn" | "info".
 * Aman dipanggil dari mana saja — tidak pernah throw.
 */
export function logLine(level, message) {
  try {
    ensureDir();
    rotateIfNeeded();
    const ts = new Date().toISOString();
    fsSync.appendFileSync(LOG_FILE, `${ts} [${level.toUpperCase()}] ${message}\n`);
  } catch {}
}

export function readRecentErrors(limit = 20) {
  try {
    if (!fsSync.existsSync(LOG_FILE)) return [];
    return fsSync.readFileSync(LOG_FILE, "utf8")
      .trim().split("\n")
      .filter((l) => l.includes("[ERROR]") || l.includes("[WARN]"))
      .slice(-limit);
  } catch {
    return [];
  }
}
