/**
 * core/config.js
 *
 * Pengelola Konfigurasi Utama EMORA berbasis YAML (`config.yml`).
 * Menggantikan .env dengan format YAML yang terstruktur dan terpusat.
 */

import fs from "fs";
import path from "path";
import { load, dump } from "js-yaml";

const CONFIG_YML = "config.yml";
const OLD_ENV = ".env";

let inMemoryConfig = null;

/** Migrasi otomatis dari .env ke config.yml jika config.yml belum ada.
 *  .env lama TIDAK dihapus — di-rename ke .env.bak agar bisa diaudit. */
function autoMigrateFromEnv() {
  const config = {};

  if (fs.existsSync(OLD_ENV)) {
    try {
      const rawEnv = fs.readFileSync(OLD_ENV, "utf8");
      // Parser dotenv tahan: dukung `export KEY=`, kutip tunggal/ganda, komentar #.
      rawEnv.split('\n').forEach(line => {
        let t = line.trim();
        if (!t || t.startsWith("#")) return;
        if (t.startsWith("export ")) t = t.slice(7).trim();
        const match = t.match(/^([\w.-]+)\s*=\s*(.*)?$/);
        if (match) {
          let key = match[1];
          let value = (match[2] || '').trim();
          // Potong komentar trailing yang tidak di dalam kutip.
          const unquoted = value.match(/^([^#'"]*)(#.*)?$/);
          if (unquoted && (value.startsWith('"') || value.startsWith("'") || value.startsWith('`'))) {
            // biarkan — komentar di dalam kutip adalah bagian nilai
          } else if (unquoted) {
            value = unquoted[1].trim();
          }
          value = value.replace(/^(['"`])(.*)\1$/, '$2').trim();
          config[key] = value;
        }
      });
      // Pindahkan konfigurasi dari gateway/config.yml jika ada
      const GATEWAY_YML = "gateway/config.yml";
      if (fs.existsSync(GATEWAY_YML)) {
         try {
            const gwDoc = load(fs.readFileSync(GATEWAY_YML, "utf8"));
            if (gwDoc) config["GATEWAY_CONFIG"] = gwDoc;
         } catch {}
      }
    } catch { /* abaikan error parse */ }
  }

  // Masukkan juga nilai default jika belum ada
  const defaults = {
    MODEL_PROVIDER: "groq",
    MODEL_NAME: "llama-3.3-70b-versatile",
    NAME: "Emora",
    DEFAULT_MODE: "autonomous",
    AGENT_MODE: "full",
    MAX_CONTEXT_MESSAGES: 20,
    LINK_BUDGET: 200000,
  };

  for (const [k, v] of Object.entries(defaults)) {
    if (!config[k]) config[k] = v;
  }

  saveConfigToFile(config);
  
  // Rename (bukan hapus) file .env lama agar tidak ada secret yang hilang diam-diam.
  if (fs.existsSync(OLD_ENV)) {
    try {
      const bak = `${OLD_ENV}.bak`;
      if (!fs.existsSync(bak)) fs.renameSync(OLD_ENV, bak);
    } catch {}
  }
  
  return config;
}

function loadConfigFromFile() {
  if (!fs.existsSync(CONFIG_YML)) {
    return autoMigrateFromEnv();
  }
  try {
    const raw = fs.readFileSync(CONFIG_YML, "utf8");
    const doc = load(raw) || {};
    // Fallback: Jika ada file .env tersisa, kita parse juga (jaga-jaga user buat manual)
    if (fs.existsSync(OLD_ENV)) {
      autoMigrateFromEnv();
    }
    return doc;
  } catch {
    return autoMigrateFromEnv();
  }
}

function saveConfigToFile(configObj) {
  try {
    const header = "# 🌟 EMORA Configuration File (config.yml)\n# Dikelola otomatis oleh EMORA CLI & Setup Wizard\n# PERHATIAN: JANGAN UPLOAD FILE INI KE GITHUB KARENA BERISI API KEYS!\n\n";
    const yamlStr = dump(configObj, { indent: 2, lineWidth: -1 });
    fs.writeFileSync(CONFIG_YML, header + yamlStr, { encoding: "utf8", mode: 0o600 });
    try { fs.chmodSync(CONFIG_YML, 0o600); } catch {}
  } catch (e) {
    console.error(`[CONFIG ERROR] Gagal menyimpan ${CONFIG_YML}:`, e.message);
  }
}

/** Validasi ringan nilai config penting. Return { ok, errors[] }. */
export function validateConfig(cfg = inMemoryConfig || {}) {
  const errors = [];
  if (cfg.MODEL_URL && !/^https?:\/\/.{3,500}$/.test(String(cfg.MODEL_URL))) {
    errors.push("MODEL_URL harus http(s)://... (3-500 chars).");
  }
  if (cfg.MODEL_NAME && String(cfg.MODEL_NAME).length > 200) {
    errors.push("MODEL_NAME >200 chars.");
  }
  const lb = Number(cfg.LINK_BUDGET);
  if (cfg.LINK_BUDGET != null && (!Number.isFinite(lb) || lb < 1000 || lb > 2_000_000)) {
    errors.push("LINK_BUDGET harus 1000-2000000.");
  }
  const mc = Number(cfg.MAX_CONTEXT_MESSAGES);
  if (cfg.MAX_CONTEXT_MESSAGES != null && (!Number.isFinite(mc) || mc < 1 || mc > 200)) {
    errors.push("MAX_CONTEXT_MESSAGES harus 1-200.");
  }
  return { ok: errors.length === 0, errors };
}

/** Redaksi API key untuk log: sk-or-v1-ab...53b8 → sk-...53b8. */
export function redactKey(key = "") {
  const s = String(key || "");
  if (s.length <= 8) return s ? "***" : "";
  return `${s.slice(0, 3)}-...${s.slice(-4)}`;
}

export function initConfig() {
  inMemoryConfig = loadConfigFromFile();
  // Sinkronkan ke process.env untuk library/modul pihak ketiga yang bergantung pada process.env (misal LangChain)
  for (const [k, v] of Object.entries(inMemoryConfig)) {
    if (v !== undefined && v !== null && typeof v !== "object") {
      process.env[k] = String(v);
    }
  }
  return inMemoryConfig;
}

export function getConfig(key, defaultValue = "") {
  if (!inMemoryConfig) initConfig();

  // Prioritize process.env if available (misal diset saat runtime via test)
  if (process.env[key]) {
    return process.env[key];
  }

  const val = inMemoryConfig[key];
  if (val !== undefined && val !== null && val !== "") return String(val);

  return defaultValue;
}

export function setConfig(key, value) {
  if (!inMemoryConfig) initConfig();
  if (!/^[A-Z0-9_.-]{1,64}$/.test(key)) throw new Error(`Config key tidak valid: '${key}'.`);
  if (String(value).length > 5000) throw new Error(`Nilai config '${key}' >5000 chars, ditolak.`);

  process.env[key] = String(value);
  inMemoryConfig[key] = value; // Simpan as-is, TANPA REDACTED lagi

  saveConfigToFile(inMemoryConfig);
}

export function deleteConfig(key) {
  if (!inMemoryConfig) initConfig();
  delete inMemoryConfig[key];
  delete process.env[key];
  saveConfigToFile(inMemoryConfig);
}

export function loadAllConfig() {
  if (!inMemoryConfig) initConfig();
  return { ...inMemoryConfig };
}

// Alias untuk kompatibilitas penuh dengan sintaksis lama (getEnv/setEnv)
export const getEnv = getConfig;
export const setEnv = setConfig;

// Inisialisasi awal saat modul dimuat
initConfig();

export default {
  getConfig,
  setConfig,
  deleteConfig,
  loadAllConfig,
  getEnv,
  setEnv,
  initConfig,
  validateConfig,
  redactKey,
};
