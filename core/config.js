/**
 * core/config.js
 *
 * Pengelola Konfigurasi Utama EMORA berbasis YAML (`config.yml`).
 * Menggantikan .env dengan format YAML yang terstruktur, bersih, dan mendukung
 * migrasi otomatis dari file .env lama jika ada.
 */

import fs from "fs";
import path from "path";
import { load, dump } from "js-yaml";
import dotenv from "dotenv";

const CONFIG_YML = "config.yml";
const OLD_ENV = ".env";

let inMemoryConfig = null;

/** Migrasi otomatis dari .env ke config.yml jika config.yml belum ada */
function autoMigrateFromEnv() {
  const config = {};

  if (fs.existsSync(OLD_ENV)) {
    try {
      const rawEnv = fs.readFileSync(OLD_ENV, "utf8");
      const parsed = dotenv.parse(rawEnv);
      Object.assign(config, parsed);
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
  return config;
}

function loadConfigFromFile() {
  if (!fs.existsSync(CONFIG_YML)) {
    return autoMigrateFromEnv();
  }
  try {
    const raw = fs.readFileSync(CONFIG_YML, "utf8");
    const doc = load(raw) || {};
    return doc;
  } catch {
    return autoMigrateFromEnv();
  }
}

function saveConfigToFile(configObj) {
  try {
    const header = "# 🌟 EMORA Configuration File (config.yml)\n# Dikelola otomatis oleh EMORA CLI & Setup Wizard\n\n";
    const yamlStr = dump(configObj, { indent: 2, lineWidth: -1 });
    fs.writeFileSync(CONFIG_YML, header + yamlStr, "utf8");
  } catch (e) {
    console.error(`[CONFIG ERROR] Gagal menyimpan ${CONFIG_YML}:`, e.message);
  }
}

export function initConfig() {
  // Load .env vars into process.env first
  dotenv.config({ path: OLD_ENV });

  inMemoryConfig = loadConfigFromFile();
  // Sinkronkan ke process.env untuk library/modul pihak ketiga yang bergantung pada process.env
  for (const [k, v] of Object.entries(inMemoryConfig)) {
    if (v !== undefined && v !== null) {
      // Avoid overwriting actual env vars with redacted placeholders
      if (v === "***REDACTED***" && process.env[k]) {
        continue;
      }
      process.env[k] = String(v);
    }
  }
  return inMemoryConfig;
}

export function getConfig(key, defaultValue = "") {
  if (!inMemoryConfig) initConfig();

  // Prioritize process.env if available and not redacted
  if (process.env[key] && process.env[key] !== "***REDACTED***") {
    return process.env[key];
  }

  const val = inMemoryConfig[key];
  if (val !== undefined && val !== null && val !== "" && val !== "***REDACTED***") return String(val);

  return defaultValue;
}

function updateDotenv(key, value) {
  if (!fs.existsSync(OLD_ENV)) return;
  let raw = fs.readFileSync(OLD_ENV, 'utf8');
  const regex = new RegExp(`^${key}=.*$`, 'm');
  const isSecret = key.includes("API") || key.includes("TOKEN") || key.includes("SECRET");

  if (value === undefined) {
    if (regex.test(raw)) {
      raw = raw.replace(new RegExp(`^${key}=.*\\n?`, 'm'), '');
      fs.writeFileSync(OLD_ENV, raw, 'utf8');
    }
    return;
  }

  if (regex.test(raw)) {
    raw = raw.replace(regex, `${key}=${value}`);
    fs.writeFileSync(OLD_ENV, raw, 'utf8');
  } else if (isSecret || regex.test(raw)) { // Append if it's a secret, or keep it synced if we want to
    raw = raw.trim() + `\n${key}=${value}\n`;
    fs.writeFileSync(OLD_ENV, raw, 'utf8');
  }
}

export function setConfig(key, value) {
  if (!inMemoryConfig) initConfig();
  
  process.env[key] = String(value);
  
  const isSecret = key.includes("API") || key.includes("TOKEN") || key.includes("SECRET");
  
  if (isSecret) {
    inMemoryConfig[key] = "***REDACTED***";
  } else {
    inMemoryConfig[key] = value;
  }
  
  saveConfigToFile(inMemoryConfig);
  updateDotenv(key, value);
}

export function deleteConfig(key) {
  if (!inMemoryConfig) initConfig();
  delete inMemoryConfig[key];
  delete process.env[key];
  saveConfigToFile(inMemoryConfig);
  updateDotenv(key, undefined);
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
};
