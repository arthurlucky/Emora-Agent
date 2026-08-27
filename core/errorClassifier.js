/**
 * core/errorClassifier.js
 *
 * Klasifikasi error API ala Hermes (agent/error_classifier.py) — diperingkas
 * ke kasus yang relevan untuk EMORA. Menentukan recovery strategy:
 *
 *   rate_limit      → backoff eksponensial lalu retry
 *   overloaded      → backoff lebih panjang, retry
 *   timeout         → langsung retry (server lambat sekali saja)
 *   context_overflow→ sinyal ke caller: COMPRESS dulu, baru retry
 *   auth / billing  → jangan buang retry — gagal cepat dengan pesan jelas
 *   unknown         → perilaku lama (throw)
 */

export const RECOVERY = {
  RETRY: "retry",
  RETRY_WITH_BACKOFF: "retry_backoff",
  RETRY_COMPACTED: "retry_compacted", // caller harus kompres messages dulu
  ABORT: "abort",
};

/** Klasifikasi satu error LLM invoke. Return { kind, recovery, delayMs }. */
export function classifyError(err) {
  const status = err?.status ?? err?.response?.status ?? 0;
  const msg = String(err?.message || err || "").toLowerCase();

  // ── HTTP status utama ────────────────────────────────────────────────────
  if (status === 401 || status === 403 || msg.includes("invalid api key") ||
      msg.includes("unauthorized") || msg.includes("invalid_api_key")) {
    return { kind: "auth", recovery: RECOVERY.ABORT };
  }
  if (status === 402 || msg.includes("insufficient") || msg.includes("billing") ||
      msg.includes("credit") || msg.includes("quota exceeded")) {
    return { kind: "billing", recovery: RECOVERY.ABORT };
  }
  if (status === 429 || msg.includes("rate limit") || msg.includes("rate_limit")) {
    return { kind: "rate_limit", recovery: RECOVERY.RETRY_WITH_BACKOFF, delayMs: 5000 };
  }
  if (status === 503 || status === 529 || msg.includes("overloaded")) {
    return { kind: "overloaded", recovery: RECOVERY.RETRY_WITH_BACKOFF, delayMs: 8000 };
  }

  // ── Context overflow: beberapa provider beda cara bilangnya ──────────────
  const overflowHints = [
    "context length", "context_length_exceeded", "maximum context",
    "too many tokens", "token limit", "max_tokens", "request too large",
    "payload too large", "reduce the length", "input length exceeds",
  ];
  if (status === 413 || overflowHints.some((h) => msg.includes(h))) {
    return { kind: "context_overflow", recovery: RECOVERY.RETRY_COMPACTED };
  }

  // ── Timeout / koneksi ────────────────────────────────────────────────────
  if (err?.name === "TimeoutError" || msg.includes("timeout") ||
      msg.includes("etimedout") || msg.includes("econnaborted")) {
    return { kind: "timeout", recovery: RECOVERY.RETRY, delayMs: 1000 };
  }

  // ── Malformed tool call (400 dari LangChain/provider) ────────────────────
  if (status === 400 && (msg.includes("tool_use") || msg.includes("tool call"))) {
    return { kind: "malformed_tool_call", recovery: RECOVERY.RETRY };
  }

  // ── Server error umum ────────────────────────────────────────────────────
  if (status >= 500 && status < 600) {
    return { kind: "server_error", recovery: RECOVERY.RETRY_WITH_BACKOFF, delayMs: 3000 };
  }

  // ECONNREFUSED / ENOTFOUND = provider mati/URL salah — retry percuma.
  if (msg.includes("econnrefused") || msg.includes("enotfound")) {
    return { kind: "connection_refused", recovery: RECOVERY.ABORT };
  }

  return { kind: "unknown", recovery: RECOVERY.ABORT };
}
