/**
 * gateway/manager.js
 *
 * Manager pusat untuk semua platform gateway (Telegram/WhatsApp/Discord).
 * Adapter tiap platform daftar diri lewat registerAdapter() saat modulnya
 * di-import, lalu Manager yang mengatur start/stop/status/users secara
 * seragam — dipakai baik oleh CLI (`emora gateway ...`) maupun TUI (`/gateway`).
 */
import { loadGatewayConfig, saveGatewayConfig } from "./config.js";
import { CronStore } from "./cron/store.js";
import { CronScheduler } from "./cron/scheduler.js";

const registry = new Map(); // type -> (platformConfig, platformName) => adapter
let adaptersLoaded = false;

/**
 * Adapter tiap platform mendaftar diri via registerAdapter() sebagai efek
 * samping saat modulnya di-import (lihat gateway/telegram/adapter.js dkk).
 * Import itu sebelumnya cuma kejadian lewat gateway/index.js — tapi CLI
 * (cli/cmd-gateway.js) & TUI (tui/slashCommands.js) import getManager()
 * LANGSUNG dari file ini, jadi importnya bisa ke-skip. Supaya gak
 * bergantung urutan import di caller, Manager men-trigger sendiri (lazy,
 * sekali saja) tepat sebelum start dipanggil.
 */
async function ensureAdaptersRegistered() {
  if (adaptersLoaded) return;
  adaptersLoaded = true;
  await Promise.all([
    import("./telegram/adapter.js"),
    import("./whatsapp/adapter.js"),
    import("./discord/index.js"),
  ]);
}

/**
 * @typedef {Object} GatewayAdapter
 * @property {string} name
 * @property {(mgr: Manager) => Promise<void>} start
 * @property {() => Promise<void>} stop
 * @property {() => {running: boolean, platform: string, info: string}} status
 * @property {(chatId: string, text: string) => Promise<void>} [sendText]
 */

export function registerAdapter(type, factory) {
  registry.set(type, factory);
}

export function hasAdapter(type) {
  return registry.has(type);
}

export function listAdapterTypes() {
  return [...registry.keys()];
}

export class Manager {
  constructor() {
    /** @type {Map<string, {config:object, adapter:GatewayAdapter, users:Map<string,object>}>} */
    this.gateways = new Map();
    this.cronStore = new CronStore();
    this.cronScheduler = new CronScheduler(this.cronStore, this);
  }

  loadConfig() {
    return loadGatewayConfig();
  }

  saveConfig(cfg) {
    return saveGatewayConfig(cfg);
  }

  async start(platform) {
    await ensureAdaptersRegistered();
    if (this.gateways.has(platform)) {
      throw new Error(`Gateway '${platform}' sudah berjalan.`);
    }
    const cfg = this.loadConfig();
    const p = cfg.platforms?.[platform];
    if (!p) throw new Error(`Gateway '${platform}' belum dikonfigurasi. Jalankan 'emora gateway setup' dulu.`);
    if (!p.enabled) throw new Error(`Gateway '${platform}' nonaktif di konfigurasi.`);

    const factory = registry.get(p.type || platform);
    if (!factory) throw new Error(`Tipe gateway '${p.type || platform}' belum punya adapter terdaftar.`);

    const adapter = factory(p, platform);
    const state = { config: p, adapter, users: new Map() };
    this.gateways.set(platform, state);

    try {
      await adapter.start(this);
    } catch (err) {
      this.gateways.delete(platform);
      throw err;
    }

    return adapter;
  }

  async startAllEnabled() {
    const cfg = this.loadConfig();
    const results = {};
    for (const [name, p] of Object.entries(cfg.platforms || {})) {
      if (!p.enabled) continue;
      try {
        await this.start(name);
        results[name] = { ok: true };
      } catch (err) {
        results[name] = { ok: false, error: err.message };
      }
    }
    this.cronScheduler.start();
    return results;
  }

  async stop(platform) {
    const state = this.gateways.get(platform);
    if (!state) throw new Error(`Gateway '${platform}' tidak sedang berjalan.`);
    await state.adapter.stop();
    for (const session of state.users.values()) {
      try { session.cancel?.(); } catch { /* noop */ }
    }
    this.gateways.delete(platform);
  }

  async stopAll() {
    const names = [...this.gateways.keys()];
    for (const name of names) {
      try { await this.stop(name); } catch { /* best effort */ }
    }
    this.cronScheduler.stop();
  }

  status() {
    const cfg = this.loadConfig();
    const out = {};
    for (const [name, p] of Object.entries(cfg.platforms || {})) {
      const state = this.gateways.get(name);
      out[name] = state
        ? state.adapter.status()
        : { running: false, platform: name, info: p.enabled ? "belum dijalankan" : "nonaktif" };
    }
    return out;
  }

  isRunning(platform) {
    return this.gateways.has(platform);
  }

  runningPlatforms() {
    return [...this.gateways.keys()];
  }

  // ── Per-user session bookkeeping (buat /gateway users) ──────────────────
  registerUser(platform, key, session) {
    const state = this.gateways.get(platform);
    if (state) state.users.set(key, session);
  }

  removeUser(platform, key) {
    const state = this.gateways.get(platform);
    if (state) state.users.delete(key);
  }

  getUserSession(platform, key) {
    return this.gateways.get(platform)?.users.get(key) || null;
  }

  getUsers(platform) {
    if (platform) {
      const state = this.gateways.get(platform);
      return state ? [...state.users.values()] : [];
    }
    const out = {};
    for (const [name, state] of this.gateways) out[name] = [...state.users.values()];
    return out;
  }

  cleanupInactiveUsers(maxIdleMs = 30 * 60 * 1000) {
    const now = Date.now();
    for (const [platform, state] of this.gateways) {
      for (const [key, session] of state.users) {
        if (session.lastActive && now - session.lastActive > maxIdleMs) {
          try { session.cancel?.(); } catch { /* noop */ }
          state.users.delete(key);
        }
      }
    }
  }

  /** Kirim pesan langsung ke sebuah chat di platform tertentu (dipakai cron). */
  async deliverMessage(platform, chatId, text) {
    const state = this.gateways.get(platform);
    if (!state) throw new Error(`Gateway '${platform}' tidak sedang berjalan, tidak bisa kirim pesan.`);
    if (typeof state.adapter.sendText !== "function") {
      throw new Error(`Gateway '${platform}' belum mendukung pengiriman pesan langsung.`);
    }
    return state.adapter.sendText(chatId, text);
  }
}

// Satu instance global dipakai bersama oleh CLI & TUI dalam proses yang sama.
let sharedManager = null;
export function getManager() {
  if (!sharedManager) sharedManager = new Manager();
  return sharedManager;
}
