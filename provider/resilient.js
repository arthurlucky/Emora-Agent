/**
 * provider/resilient.js
 *
 * Retry + auto-failover antar profile (pure logic + wrapper tipis).
 * Kebijakan (sesuai persetujuan user): otomatis failover, lalu laporkan 1 baris.
 */
import { logLine } from "../utils/logger.js";

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const DEFAULT_RETRIES = 2;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function isRetryableError(err) {
  const status = err?.status ?? err?.response?.status ?? err?.code;
  if (typeof status === "number" && RETRYABLE.has(status)) return true;
  const msg = String(err?.message || "").toLowerCase();
  return /429|rate.?limit|timeout|timed out|econnreset|enotfound|socket hang up|temporarily|overloaded|503|502|504/.test(msg);
}

function timeoutRace(promise, ms) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(t)), timeout]);
}

/** Jalankan fn dengan retry backoff. Pure — fn di-inject (mudah di-test). */
export async function withRetry(fn, { retries = DEFAULT_RETRIES, baseDelayMs = 500, timeoutMs = 60_000 } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await timeoutRace(fn(attempt), timeoutMs);
    } catch (err) {
      last = err;
      if (attempt >= retries || !isRetryableError(err)) throw err;
      const delay = baseDelayMs * 2 ** attempt;
      logLine("warn", `[RESILIENT] attempt ${attempt + 1} gagal (${err.message}). Retry ${delay}ms.`);
      await sleep(delay);
    }
  }
  throw last;
}

/** Daftar profile fallback dari env FALLBACK_PROFILES="a,b,c". */
export function fallbackList() {
  return (process.env.FALLBACK_PROFILES || "")
    .split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5);
}

/**
 * Coba panggil primary, lalu fallback berurutan.
 * tryCall(profileName) → Promise hasil. Pure-injectable untuk test.
 */
export async function callWithFallback(primary, fallbacks, tryCall) {
  const order = [primary, ...fallbacks.filter((f) => f && f !== primary)];
  let lastErr;
  for (const name of order) {
    try {
      const res = await withRetry(() => tryCall(name), {});
      return { profile: name, result: res, failedOver: name !== primary };
    } catch (err) {
      lastErr = err;
      logLine("warn", `[RESILIENT] profile '${name}' gagal: ${err.message}`);
    }
  }
  throw lastErr;
}
