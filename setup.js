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
  ]);

  setEnv("MODEL_PROVIDER", provider);

  // Config per provider
  if (provider === "ollama") {
    const host = await input("Ollama host:", "http://localhost:11434");
    const hostClean = host.replace(/\/$/, "");
    setEnv("MODEL_URL", `${hostClean}/v1`);
    setEnv("MODEL_API", "ollama");

    // Auto-scan model
    const doScan = await confirm("Auto scan model dari Ollama?", { default: true });

    let modelName = "";
    if (doScan) {
      const spinner = ora("  Scanning model di Ollama...").start();
      try {
        const res  = await fetch(`${hostClean}/api/tags`);
        const data = await res.json();
        const models = (data.models || []).map((m) => m.name);

        if (!models.length) {
          spinner.warn("Tidak ada model ditemukan.");
          modelName = await input("Nama model Ollama:", "llama3.2:3b");
        } else {
          spinner.succeed(`Ditemukan ${models.length} model`);
          modelName = await select(
            "Pilih model:",
            models.map((m) => ({ label: m, value: m }))
          );
        }
      } catch {
        spinner.fail("Gagal terhubung ke Ollama.");
        modelName = await input("Nama model Ollama:", "llama3.2:3b");
      }
    } else {
      modelName = await input("Nama model Ollama:", "llama3.2:3b");
    }

    setEnv("MODEL_NAME", modelName);

    // Test koneksi
    const spin2 = ora(`  Menguji ${modelName}...`).start();
    try {
      const host2 = (await hostClean) + "";
      const r = await fetch(`${host2}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelName }),
      });
      r.ok ? spin2.succeed("Model tersedia!") : spin2.warn("Model mungkin belum didownload.");
    } catch {
      spin2.fail("Gagal terhubung ke Ollama saat test.");
    }

  } else if (provider === "anthropic") {
    console.log();
    warnLine("Butuh: npm install @langchain/anthropic");
    warnLine("Dapatkan API key di: https://console.anthropic.com");
    console.log(chalk.hex("#58a6ff")("  │"));

    const apiKey = await input("Anthropic API Key:", "", true);
    setEnv("ANTHROPIC_API_KEY", apiKey);
    setEnv("MODEL_API", apiKey);
    setEnv("MODEL_URL", "https://api.anthropic.com/v1");

    const model = await select("Pilih model Claude:", [
      { label: "claude-sonnet-4-5          [Recommended — balance terbaik]", value: "claude-sonnet-4-5" },
      { label: "claude-haiku-4-5           [Tercepat & termurah]",           value: "claude-haiku-4-5" },
      { label: "claude-opus-4-5            [Paling cerdas, paling mahal]",   value: "claude-opus-4-5" },
      { label: "claude-3-5-sonnet-20241022 [Stable release]",                value: "claude-3-5-sonnet-20241022" },
    ]);
    setEnv("MODEL_NAME", model);

  } else if (provider === "huggingface") {
    warnLine("Dapatkan token di: https://huggingface.co/settings/tokens");
    const apiKey = await input("HuggingFace Token:", "", true);
    setEnv("HUGGINGFACE_API_KEY", apiKey);
    setEnv("MODEL_API", apiKey);
    setEnv("MODEL_URL", "https://api-inference.huggingface.co/v1");

    const useCustom = await confirm("Punya Dedicated Endpoint (HF Inference Endpoints)?", { default: false });
    if (useCustom) {
      const endpoint = await input("URL Dedicated Endpoint:");
      setEnv("HUGGINGFACE_ENDPOINT_URL", endpoint);
      setEnv("MODEL_URL", endpoint.endsWith("/v1") ? endpoint : `${endpoint}/v1`);
      setEnv("MODEL_NAME", "tgi");
    } else {
      const model = await select("Pilih model HuggingFace:", [
        { label: "Llama 3.1 8B Instruct    [Gratis, paling stabil]",   value: "meta-llama/Meta-Llama-3.1-8B-Instruct" },
        { label: "Mistral 7B Instruct v0.3 [Gratis, tool calling OK]", value: "mistralai/Mistral-7B-Instruct-v0.3" },
        { label: "Qwen 2.5 72B Instruct    [Butuh HF Pro]",            value: "Qwen/Qwen2.5-72B-Instruct" },
        { label: "Llama 3.1 70B Instruct   [Butuh HF Pro]",            value: "meta-llama/Meta-Llama-3.1-70B-Instruct" },
      ]);
      setEnv("MODEL_NAME", model);
    }

  } else {
    // Semua provider openai-compat lainnya
    const PROVIDER_DEFAULTS = {
      groq:       { url: "https://api.groq.com/openai/v1",                              model: "llama-3.3-70b-versatile",        keyUrl: "https://console.groq.com" },
      gemini:     { url: "https://generativelanguage.googleapis.com/v1beta/openai/",    model: "gemini-2.0-flash",               keyUrl: "https://aistudio.google.com/app/apikey" },
      openrouter: { url: "https://openrouter.ai/api/v1",                                model: "google/gemini-2.0-flash-exp:free",keyUrl: "https://openrouter.ai/keys" },
      nvidia:     { url: "https://integrate.api.nvidia.com/v1",                         model: "meta/llama-3.1-70b-instruct",    keyUrl: "https://build.nvidia.com" },
      openai:     { url: "https://api.openai.com/v1",                                   model: "gpt-4o-mini",                    keyUrl: "https://platform.openai.com/api-keys" },
    };

    const defaults = PROVIDER_DEFAULTS[provider];
    console.log();
    infoLine("Dapatkan API key di:", defaults.keyUrl, "cyan");
    console.log(chalk.hex("#58a6ff")("  │"));

    const apiKey   = await input("API Key:", "", true);
    const modelIn  = await input("Nama model:", defaults.model);

    setEnv("MODEL_URL", defaults.url);
    setEnv("MODEL_API", apiKey);
    setEnv("MODEL_NAME", modelIn || defaults.model);
  }

  // Tavily (opsional, untuk web search)
  if (!getEnv("TAVILY_API_KEY")) {
    console.log(chalk.hex("#58a6ff")("  │"));
    const setTavily = await confirm("Setup Tavily API (web search)? Bisa dilewati", { default: false });
    if (setTavily) {
      warnLine("Dapatkan di: https://app.tavily.com (gratis hingga 1000 req/bln)");
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
