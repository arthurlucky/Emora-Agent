/**
 * gateway/config.js
 *
 * Konfigurasi multi-platform untuk gateway EMORA (Telegram, WhatsApp, Discord,
 * Slack, Matrix). FORMAT UTAMA: config.yml (human-friendly + komentar).
 * Backward compat: gateways.config.json lama otomatis dimigrasikan ke YAML
 * saat load pertama; kalau keduanya kosong, migrasi dari .env.
 */
import fs from "fs";
import path from "path";
import { load as yamlLoad, dump as yamlDump } from "js-yaml";
// FORMAT UTAMA: config.yml (human-friendly, komentar didukung).
// Backward compat: gateways.config.json lama tetap dibaca; save selalu ke YAML.
const CONFIG_PATH = process.env.EMORA_GATEWAY_CONFIG
  ? path.resolve(process.env.EMORA_GATEWAY_CONFIG)
  : path.resolve("./gateway/config.yml");
const LEGACY_JSON_PATH = path.resolve("./gateway/gateways.config.json");

function splitList(raw) {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Bangun config awal dari variabel .env yang sudah ada (migrasi satu arah). */
function fromEnv() {
  const platforms = {};

  if (process.env.TELEGRAM_TOKEN_BOT) {
    platforms.telegram = {
      type: "telegram",
      enabled: process.env.TELEGRAM_GATEWAY === "true",
      token: process.env.TELEGRAM_TOKEN_BOT,
      allowedUsers: splitList(process.env.TELEGRAM_ALLOWED_IDS),
      maxUsers: 0,
      extra: {},
    };
  }

  if (process.env.WA_PHONE_NUMBER) {
    platforms.whatsapp = {
      type: "whatsapp",
      enabled: process.env.WA_GATEWAY === "true",
      token: "", // WhatsApp pakai pairing code, bukan bot token
      allowedUsers: splitList(process.env.WA_ALLOWED_NUMBERS),
      maxUsers: 0,
      extra: { phoneNumber: process.env.WA_PHONE_NUMBER },
    };
  }

  if (process.env.DISCORD_TOKEN_BOT) {
    platforms.discord = {
      type: "discord",
      enabled: process.env.DISCORD_GATEWAY === "true",
      token: process.env.DISCORD_TOKEN_BOT,
      allowedUsers: splitList(process.env.DISCORD_ALLOWED_IDS),
      maxUsers: Number(process.env.DISCORD_MAX_USERS || 0) || 0,
      extra: { guildId: process.env.DISCORD_GUILD_ID || "" },
    };
  }

  return {
    enabled: Object.values(platforms).some((p) => p.enabled),
    platforms,
  };
}

function normalize(cfg) {
  if (!cfg || typeof cfg !== "object") return { enabled: false, platforms: {} };
  if (!cfg.platforms || typeof cfg.platforms !== "object") cfg.platforms = {};
  for (const key of Object.keys(cfg.platforms)) {
    const p = cfg.platforms[key];
    // PENTING: spread `...p` DULU supaya field spesifik-platform (mis.
    // Slack butuh `botToken`+`appToken`, Matrix butuh `baseUrl`+
    // `accessToken`+`userId` — lihat gateway/slack/index.js &
    // gateway/matrix/index.js) ikut kesimpan. Sebelumnya field-field ini
    // SELALU HILANG setiap kali config disave, karena cuma daftar field
    // generik di bawah ini yang dipertahankan — akibatnya Slack & Matrix
    // gak mungkin bisa dikonfigurasi sama sekali lewat cmdSetup/setup.js.
    cfg.platforms[key] = {
      ...p,
      type: p.type || key,
      enabled: !!p.enabled,
      token: p.token || "",
      appId: p.appId || "",
      allowedUsers: Array.isArray(p.allowedUsers) ? p.allowedUsers : [],
      maxUsers: Number(p.maxUsers || 0) || 0,
      extra: p.extra && typeof p.extra === "object" ? p.extra : {},
    };
  }
  return cfg;
}

export function loadGatewayConfig() {
  // 1. config.yml (utama)
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return normalize(yamlLoad(raw));
  } catch { /* belum ada / parse gagal → cek legacy */ }

  // 2. Legacy JSON — baca sekali, migrasi otomatis ke YAML.
  try {
    const raw = fs.readFileSync(LEGACY_JSON_PATH, "utf8");
    const cfg = normalize(JSON.parse(raw));
    try {
      saveGatewayConfig(cfg);
      console.log(`[config] Dimigrasikan: gateways.config.json → config.yml`);
    } catch {}
    return cfg;
  } catch { /* legacy juga tidak ada */ }

  // 3. Migrasi dari .env
  return normalize(fromEnv());
}

export function saveGatewayConfig(cfg) {
  const dir = path.dirname(CONFIG_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, yamlDump(normalize(cfg), { lineWidth: 120 }), { mode: 0o600 });
  return loadGatewayConfig();
}

export function getPlatformConfig(name) {
  return loadGatewayConfig().platforms[name] || null;
}

export function setPlatformConfig(name, patch) {
  const cfg = loadGatewayConfig();
  cfg.platforms[name] = { ...(cfg.platforms[name] || { type: name }), ...patch };
  return saveGatewayConfig(cfg);
}

export { CONFIG_PATH };
