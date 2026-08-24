/**
 * gateway/session.js
 *
 * State "turn" per-chat yang dipakai gateway (Telegram/WhatsApp/Discord):
 * mode approval (safe/autonomous), status lagi-jalan-atau-tidak, dan
 * AbortController buat `/stop`.
 *
 * Sengaja DIPISAH dari pemetaan chatId -> session id percakapan itu
 * sendiri. Telegram & WhatsApp sudah punya cara sendiri buat itu (pola
 * `sessions[chatId] = crypto.randomUUID()` yang sudah ada & sudah
 * kompatibel dengan core/sessionStore.js karena formatnya UUID) — jadi di
 * sini cukup nambah kapabilitas baru (approval/mode/stop) tanpa mengganggu
 * riwayat chat yang sudah berjalan.
 */
const INACTIVITY_MS = 30 * 60 * 1000; // 30 menit

export class TurnStateManager {
  constructor(platform) {
    this.platform = platform;
    /** @type {Map<string, {mode:string, isRunning:boolean, activeAbort:AbortController|null, lastActive:number}>} */
    this.state = new Map();
  }

  _get(chatId) {
    let s = this.state.get(chatId);
    if (!s) {
      s = { mode: "autonomous", isRunning: false, activeAbort: null, lastActive: Date.now() };
      this.state.set(chatId, s);
    }
    return s;
  }

  getMode(chatId) {
    return this._get(chatId).mode;
  }

  setMode(chatId, mode) {
    const s = this._get(chatId);
    s.mode = mode === "safe" ? "safe" : "autonomous";
    return s.mode;
  }

  /** Mulai turn baru: tandai running & buat AbortController baru untuk `/stop`.
   *  userId dicatat untuk verifikasi approval (hanya pengirim asli boleh approve). */
  beginTurn(chatId, userId = null) {
    const s = this._get(chatId);
    s.isRunning = true;
    s.activeUserId = userId;
    s.activeAbort = new AbortController();
    s.lastActive = Date.now();
    return s.activeAbort.signal;
  }

  /** User id pengirim turn yang sedang berjalan (untuk gate approve/deny). */
  getActiveUserId(chatId) {
    return this.state.get(chatId)?.activeUserId ?? null;
  }

  endTurn(chatId) {
    const s = this.state.get(chatId);
    if (s) {
      s.isRunning = false;
      s.activeAbort = null;
    }
  }

  isRunning(chatId) {
    return !!this.state.get(chatId)?.isRunning;
  }

  /** Dipanggil dari `/stop`. Return true kalau memang ada yang dihentikan. */
  stop(chatId) {
    const s = this.state.get(chatId);
    if (s?.isRunning && s.activeAbort) {
      s.activeAbort.abort();
      return true;
    }
    return false;
  }

  touch(chatId) {
    this._get(chatId).lastActive = Date.now();
  }

  activeChatCount() {
    return this.state.size;
  }

  cleanupInactive(maxIdleMs = INACTIVITY_MS) {
    const now = Date.now();
    for (const [chatId, s] of this.state) {
      if (!s.isRunning && now - s.lastActive > maxIdleMs) this.state.delete(chatId);
    }
  }
}
