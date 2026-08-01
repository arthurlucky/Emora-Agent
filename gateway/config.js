/**
 * gateway/config.js
 *
 * Konfigurasi multi-platform untuk gateway EMORA (Telegram, WhatsApp, Discord).
 * Disimpan sebagai JSON di dalam folder project (konsisten dengan memory/,
 * skill/, library/, dll — bukan di home directory user), supaya instalasi
 * EMORA tetap portable dalam satu folder.
 *
 * Backward compatible: kalau file config belum ada, kita "migrasikan" nilai
 * dari .env (TELEGRAM_TOKEN_BOT, WA_PHONE_NUMBER, dst) supaya instalasi lama
 * tetap jalan tanpa perlu setup ulang manual.
 */
import fs from "fs";
import path from "path";

const CONFIG_PATH = path.resolve("./gateway/gateways.config.json");

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
    cfg.platforms[key] = {
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
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    return normalize(JSON.parse(raw));
  } catch {
    return normalize(fromEnv());
  }
}

export function saveGatewayConfig(cfg) {
  const dir = path.dirname(CONFIG_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(normalize(cfg), null, 2), { mode: 0o600 });
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
