/**
 * setup.js — EMORA Interactive Setup
 * Dipanggil via: emora setup
 *
 * Arrow key ↑↓ + Enter untuk navigasi semua menu.
 * Tidak ada ketik nomor sama sekali.
 */

import "dotenv/config";
import fs from "fs";
import chalk from "chalk";
import ora from "ora";
import figlet from "figlet";

import {
  select, confirm, input,
  sectionHeader, sectionFooter,
  infoLine, successLine, warnLine, errorLine,
} from "./cli/select.js";
import { PROVIDERS, getProviderModels, getKeyUrl } from "./provider/index.js";
import * as ollamaMod from "./provider/ollama/index.js";

// ─────────────────────────────────────────────
// .ENV HELPERS
// ─────────────────────────────────────────────
const ENV_PATH = "./.env";

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return "";
  return fs.readFileSync(ENV_PATH, "utf8");
}

function setEnv(key, value) {
  let content = readEnv();
  const regex = new RegExp(`^${key}=.*$`, "m");
  const line  = `${key}=${value}`;
  content = regex.test(content)
    ? content.replace(regex, line)
    : content + (content.endsWith("\n") || content === "" ? "" : "\n") + line;
  fs.writeFileSync(ENV_PATH, content.trim() + "\n");
}

function getEnv(key) {
  const match = readEnv().match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1].trim() : "";
}

// ─────────────────────────────────────────────
// BANNER
// ─────────────────────────────────────────────
function showSetupBanner() {
  console.clear();
  const logo = figlet.textSync("EMORA", { font: "ANSI Shadow" });
  logo.split("\n").forEach((l, i) => {
    const colors = [
      chalk.hex("#58a6ff"), chalk.hex("#6aabff"),
      chalk.hex("#7db0f7"), chalk.hex("#9299f7"), chalk.hex("#a371f7"),
    ];
    if (l.trim()) console.log(colors[i % colors.length].bold(l));
  });

  const w = Math.min(process.stdout.columns || 80, 88);
  console.log();
  console.log(chalk.hex("#58a6ff")("  ") + chalk.hex("#8b949e")("Interactive Setup Wizard"));
  console.log(chalk.hex("#30363d")("─".repeat(w)));
  console.log();
}

// ─────────────────────────────────────────────
// SETUP SECTIONS
// ─────────────────────────────────────────────

async function setupProvider() {
  sectionHeader("AI PROVIDER", "Pilih provider untuk model bahasa EMORA");

  const provider = await select("Pilih provider AI:", [
    { label: "Groq               — Gratis, cepat, llama/gemma",   value: "groq",        hint: "GRATIS" },
    { label: "Google Gemini      — Gratis, gemini-2.0-flash",      value: "gemini",      hint: "GRATIS" },
    { label: "OpenRouter         — Multi-model, ada yg gratis",    value: "openrouter",  hint: "GRATIS" },
    { label: "NVIDIA NIM         — Gratis, llama enterprise",      value: "nvidia",      hint: "GRATIS" },
    { label: "HuggingFace        — Custom model, gratis/pro",      value: "huggingface", hint: "GRATIS" },
    { label: "Anthropic Claude   — Claude 3.5/4, terbaik",         value: "anthropic",   hint: "BAYAR"  },
    { label: "OpenAI             — GPT-4o, paling populer",        value: "openai",      hint: "BAYAR"  },
    { label: "Ollama (Lokal)     — Jalankan model di device sendiri", value: "ollama",   hint: "LOKAL"  },
    { label: "Custom Endpoint    — LM Studio, vLLM, dsb",          value: "custom",      hint: "CUSTOM" },
  ]);

  setEnv("MODEL_PROVIDER", provider);

  // Config per provider
  if (provider === "ollama") {
    const host = await input("Ollama host:", getEnv("OLLAMA_HOST") || "http://localhost:11434");
    const hostClean = host.replace(/\/$/, "");
    setEnv("OLLAMA_HOST", hostClean);
    setEnv("MODEL_URL", `${hostClean}/v1`);
    setEnv("MODEL_API", "ollama");

    const doScan = await confirm("Auto scan model dari Ollama?", { default: true });
    let modelName = "";

    if (doScan) {
      const spinner = ora("  Scanning model...").start();
      try {
        const res  = await fetch(`${hostClean}/api/tags`, { signal: AbortSignal.timeout(4000) });
        const data = await res.json();
        const models = (data.models || []).map(m => m.name);

        if (!models.length) {
          spinner.warn("Tidak ada model. Pilih dari daftar populer atau ketik manual.");
          const known = ollamaMod.KNOWN_MODELS.map(m => ({ label: m.label, value: m.id }));
          known.push({ label: "Ketik sendiri...", value: "__manual__" });
          let chosen = await select("Pilih model:", known);
          modelName = chosen === "__manual__" ? await input("Nama model:") : chosen;
        } else {
          spinner.succeed(`Ditemukan ${models.length} model`);
          modelName = await select("Pilih model:", models.map(m => ({ label: m, value: m })));
        }
      } catch {
        spinner.fail("Ollama tidak bisa dijangkau.");
        modelName = await input("Nama model:", ollamaMod.DEFAULT_MODEL);
      }
    } else {
      const known = ollamaMod.KNOWN_MODELS.map(m => ({ label: m.label, value: m.id }));
      known.push({ label: "Ketik sendiri...", value: "__manual__" });
      let chosen = await select("Pilih model:", known);
      modelName = chosen === "__manual__" ? await input("Nama model:") : chosen;
    }

    setEnv("MODEL_NAME", modelName);

    // Test
    const spin2 = ora(`  Test koneksi ke ${modelName}...`).start();
    try {
      const r = await fetch(`${hostClean}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelName }),
        signal: AbortSignal.timeout(4000),
      });
      r.ok ? spin2.succeed("Model tersedia!") : spin2.warn("Model mungkin belum didownload — jalankan: ollama pull " + modelName);
    } catch {
      spin2.fail("Gagal terhubung ke Ollama saat test.");
    }

  } else {
    // Semua provider lain: load metadata dan model list dari masing-masing provider module
    const modPath   = provider === "custom" ? "./provider/customEndpoint/index.js" : `./provider/${provider}/index.js`;
    let provMod     = {};
    try { provMod = await import(modPath); } catch {}

    const keyUrl    = provMod.KEY_URL || null;
    const baseUrl   = provMod.BASE_URL || null;
    const models    = provMod.MODELS   || [];
    const defModel  = provMod.DEFAULT_MODEL || "";

    console.log(chalk.hex("#58a6ff")("  │"));

    // Anthropic special: install hint
    if (provider === "anthropic") {
      warnLine("Butuh extra package: npm install @langchain/anthropic");
    }

    if (keyUrl) infoLine("Dapatkan API key di:", keyUrl, "cyan");
    console.log(chalk.hex("#58a6ff")("  │"));

    // API key
    if (provider === "ollama") {
      // skip — sudah ditangani di branch atas
    } else if (provider === "custom") {
      const customUrl = await input("Base URL endpoint (mis. http://localhost:1234/v1):", getEnv("MODEL_URL") || "");
      setEnv("MODEL_URL", customUrl);
      const apiKey = await input("API Key (kosong jika tidak ada):", "", false);
      if (apiKey) setEnv("MODEL_API", apiKey);
    } else {
      const envKeyName = {
        anthropic:   "ANTHROPIC_API_KEY",
        huggingface: "HUGGINGFACE_API_KEY",
        openai:      "OPENAI_API_KEY",
      }[provider] || "MODEL_API";

      const apiKey = await input(`${PROVIDERS[provider]?.label || provider} API Key:`, "", true);
      setEnv(envKeyName,  apiKey);
      setEnv("MODEL_API", apiKey);
      if (baseUrl) setEnv("MODEL_URL", baseUrl);
    }

    // HuggingFace dedicated endpoint
    if (provider === "huggingface") {
      const useCustom = await confirm("Punya HF Dedicated Endpoint?", { default: false });
      if (useCustom) {
        const endpoint = await input("URL Dedicated Endpoint:");
        setEnv("HUGGINGFACE_ENDPOINT_URL", endpoint);
        setEnv("MODEL_URL", endpoint.endsWith("/v1") ? endpoint : `${endpoint.replace(/\/$/, "")}/v1`);
        setEnv("MODEL_NAME", "tgi");
        successLine("Custom endpoint disimpan");
        successLine("Konfigurasi provider berhasil disimpan");
        sectionFooter();
        return;
      }
    }

    // Model selection dari provider module
    if (models.length) {
      const choices = models.map(m => ({ label: m.label || m.id, value: m.id }));
      choices.push({ label: "Ketik nama model sendiri...", value: "__custom__" });
      let chosen = await select("Pilih model:", choices);
      if (chosen === "__custom__") chosen = await input("Nama model:");
      setEnv("MODEL_NAME", chosen);
    } else {
      setEnv("MODEL_NAME", await input("Nama model:", defModel));
    }
  }

  // Tavily (opsional, untuk web search)
  if (!getEnv("TAVILY_API_KEY")) {
    console.log(chalk.hex("#58a6ff")("  │"));
    const setTavily = await confirm("Setup Tavily API (web search)? Bisa dilewati", { default: false });
    if (setTavily) {
      warnLine("Dapatkan di: https://app.tavily.com (gratis 1000 req/bln)");
      const tavilyKey = await input("Tavily API Key:", "", true);
      setEnv("TAVILY_API_KEY", tavilyKey);
    }
  }

  successLine("Konfigurasi provider berhasil disimpan");
  sectionFooter();
}

async function setupGateway() {
  sectionHeader("MESSAGING GATEWAY", "Hubungkan EMORA ke WhatsApp / Telegram");

  const gw = await select("Aktifkan gateway:", [
    { label: "Telegram saja",          value: "telegram"  },
    { label: "WhatsApp saja",          value: "whatsapp"  },
    { label: "Keduanya",               value: "both"      },
    { label: "Nonaktifkan semua",      value: "none"      },
  ]);

  // Reset dulu
  setEnv("TELEGRAM_GATEWAY", "false");
  setEnv("WA_GATEWAY",       "false");

  if (gw === "telegram" || gw === "both") {
    console.log(chalk.hex("#58a6ff")("  │"));
    infoLine("Platform", "Telegram Bot API via Telegraf", "cyan");
    const token   = await input("Bot Token (dari @BotFather):", "", true);
    const allowed = await input("Allowed User IDs (pisah koma, kosong = semua):");
    setEnv("TELEGRAM_GATEWAY",     "true");
    setEnv("TELEGRAM_TOKEN_BOT",   token.trim());
    setEnv("TELEGRAM_ALLOWED_IDS", allowed.trim());
    successLine("Telegram dikonfigurasi");
  }

  if (gw === "whatsapp" || gw === "both") {
    console.log(chalk.hex("#58a6ff")("  │"));
    infoLine("Platform",  "WhatsApp via Baileys (Pairing Code)", "cyan");
    infoLine("Format",    "Kode negara + nomor tanpa 0 depan", "yellow");
    infoLine("Contoh",    "6281234567890", "yellow");

    const phone   = await input("Nomor WhatsApp:");
    const allowed = await input("Allowed Numbers (pisah koma, kosong = semua):");
    const clean   = phone.trim().replace(/\D/g, "");

    if (!clean || clean.length < 10) {
      errorLine("Nomor tidak valid. WhatsApp dilewati.");
    } else {
      setEnv("WA_GATEWAY",       "true");
      setEnv("WA_PHONE_NUMBER",  clean);
      setEnv("WA_ALLOWED_NUMBERS", allowed.trim());
      successLine(`WhatsApp dikonfigurasi: ${clean}`);
      warnLine("Pairing Code akan muncul di terminal saat pertama kali dijalankan");
    }
  }

  if (gw === "none") {
    successLine("Semua gateway dinonaktifkan");
  }

  sectionFooter();
}

async function setupWebUI() {
  sectionHeader("WEB UI", "Panel kontrol berbasis browser untuk EMORA");

  const enable = await confirm("Aktifkan Web UI?", { default: false });
  setEnv("WEBUI", enable ? "true" : "false");

  if (enable) {
    const port = await input("Port Web UI:", getEnv("WEBUI_PORT") || "5090");
    setEnv("WEBUI_PORT", port);
    successLine(`Web UI diaktifkan di port ${port}`);
    infoLine("Jalankan dengan", "emora --web  atau  npm start --web", "cyan");
  } else {
    successLine("Web UI dinonaktifkan");
  }
  sectionFooter();
}

async function setupName() {
  sectionHeader("IDENTITAS AGENT", "Nama yang dipakai EMORA saat mengobrol");
  const name = await input("Nama agent:", getEnv("NAME") || "Emora");
  setEnv("NAME", name);
  successLine(`Nama agent: ${name}`);
  sectionFooter();
}

// ─────────────────────────────────────────────
// MAIN MENU
// ─────────────────────────────────────────────
async function setup() {
  showSetupBanner();

  // Buat folder-folder yang diperlukan
  for (const dir of ["./uploads", "./downloads", "./memory", "./backups"]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Buat .env kalau belum ada
  if (!fs.existsSync(ENV_PATH)) {
    fs.writeFileSync(ENV_PATH, "");
    console.log(chalk.hex("#3fb950")("  ✓ File .env dibuat\n"));
  }

  let running = true;

  while (running) {
    // Refresh banner tiap balik ke menu utama
    const tgActive = getEnv("TELEGRAM_GATEWAY") === "true";
    const waActive = getEnv("WA_GATEWAY") === "true";
    const model    = getEnv("MODEL_NAME") || "—";
    const provider = getEnv("MODEL_PROVIDER") || "—";

    sectionHeader("SETUP MENU", `Provider: ${provider}  /  Model: ${model}`);
    infoLine("Telegram", tgActive ? "✓ Aktif" : "○ Nonaktif", tgActive ? "green" : "yellow");
    infoLine("WhatsApp",  waActive ? "✓ Aktif" : "○ Nonaktif", waActive ? "green" : "yellow");
    console.log(chalk.hex("#58a6ff")("  │"));

    const choice = await select("Apa yang ingin dikonfigurasi?", [
      { label: "🤖  AI Provider & Model",    value: "provider" },
      { label: "📡  Messaging Gateway",      value: "gateway"  },
      { label: "🌐  Web UI",                 value: "webui"    },
      { label: "✏️   Nama & Identitas Agent", value: "name"     },
      { label: "🚀  Selesai & Keluar",       value: "exit"     },
    ]);

    switch (choice) {
      case "provider": await setupProvider(); break;
      case "gateway":  await setupGateway();  break;
      case "webui":    await setupWebUI();    break;
      case "name":     await setupName();     break;
      case "exit":
        running = false;
        console.clear();
        showSetupBanner();
        sectionHeader("SETUP SELESAI", "Konfigurasi berhasil disimpan");
        successLine("Jalankan EMORA dengan perintah:  emora");
        successLine("Start dengan gateway:            emora gateway");
        successLine("Cek status:                      emora status");
        sectionFooter();
        break;
    }
  }
}

setup().catch((err) => {
  console.error(chalk.hex("#f85149")(`\n[SETUP ERROR] ${err.message}\n`));
  process.exit(1);
});
