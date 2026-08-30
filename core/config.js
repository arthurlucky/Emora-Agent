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
  inMemoryConfig = loadConfigFromFile();
  // Sinkronkan ke process.env untuk library/modul pihak ketiga yang bergantung pada process.env
  for (const [k, v] of Object.entries(inMemoryConfig)) {
    if (v !== undefined && v !== null) {
      process.env[k] = String(v);
    }
  }
  return inMemoryConfig;
}

export function getConfig(key, defaultValue = "") {
  if (!inMemoryConfig) initConfig();
  const val = inMemoryConfig[key];
  if (val !== undefined && val !== null && val !== "") return String(val);
  return process.env[key] || defaultValue;
}

export function setConfig(key, value) {
  if (!inMemoryConfig) initConfig();
  inMemoryConfig[key] = value;
  process.env[key] = String(value);
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
};
