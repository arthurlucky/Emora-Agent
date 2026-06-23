/**
 * cli/cmd-status.js — `emora status`
 * Live status dari semua komponen EMORA: provider, gateway, skill, memory.
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import ora from "ora";

const C = {
  cyan:    (t) => chalk.hex("#58a6ff")(t),
  green:   (t) => chalk.hex("#3fb950")(t),
  yellow:  (t) => chalk.hex("#d29922")(t),
  red:     (t) => chalk.hex("#f85149")(t),
  purple:  (t) => chalk.hex("#a371f7")(t),
  muted:   (t) => chalk.hex("#8b949e")(t),
  dim:     (t) => chalk.hex("#6e7681")(t),
  primary: (t) => chalk.hex("#e6edf3")(t),
  bold:    chalk.bold,
};

function row(label, value, status = "ok") {
  const statusSymbol = status === "ok"      ? C.green("●")
                     : status === "warn"    ? C.yellow("●")
                     : status === "off"     ? C.dim("○")
                     : C.red("✗");
  process.stdout.write(
    C.cyan("  │  ") +
    statusSymbol + "  " +
    C.muted(String(label).padEnd(26)) +
    C.primary(value) + "\n"
  );
}

function divider(title = "") {
  const w = Math.min(process.stdout.columns || 80, 88) - 3;
  if (title) {
    process.stdout.write(C.cyan("  │\n  │  ") + C.purple.bold(title) + "\n");
    process.stdout.write(C.cyan("  │  ") + C.dim("─".repeat(w - 5)) + "\n");
  } else {
    process.stdout.write(C.cyan("  │\n"));
  }
}

function header(title) {
  const w = Math.min(process.stdout.columns || 80, 88);
  console.log();
  console.log(C.cyan.bold("  ╭─ EMORA STATUS ") + C.dim("─".repeat(w - 19)));
  console.log(C.cyan("  │  ") + C.muted(new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })));
}

function footer() {
  const w = Math.min(process.stdout.columns || 80, 88);
  console.log(C.cyan("  │"));
  console.log(C.cyan.bold("  ╰" + "─".repeat(w - 3)));
  console.log();
}

function getEnv(k, file = "./.env") {
  try {
    const m = fs.readFileSync(file, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"));
    return m ? m[1].trim() : "";
  } catch { return ""; }
}

async function checkOllama(host) {
  try {
    const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.models || []).map(m => m.name);
  } catch { return null; }
}

async function checkTelegramToken(token) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(3000) });
    const body = await res.json();
    return body.ok ? body.result : null;
  } catch { return null; }
}

export async function cmdStatus() {
  header();

  // ── Agent Identity ────────────────────────────────────────────────────────
  divider("AGENT");
  const name    = getEnv("NAME") || "Emora";
  const version = (() => { try { return JSON.parse(fs.readFileSync("./package.json","utf8")).version; } catch { return "—"; } })();
  row("Name",    name);
  row("Version", `v${version}`);

  // ── Provider / Model ──────────────────────────────────────────────────────
  divider("MODEL PROVIDER");
  const provider = getEnv("MODEL_PROVIDER") || "—";
  const model    = getEnv("MODEL_NAME") || "—";
  const modelUrl = getEnv("MODEL_URL") || "—";

  row("Provider", provider, provider !== "—" ? "ok" : "warn");
  row("Model",    model,    model !== "—"    ? "ok" : "warn");

  // Kalau Ollama, cek live
  if (provider === "ollama" || modelUrl.includes("localhost") || modelUrl.includes("11434")) {
    const host = modelUrl.replace("/v1", "") || "http://localhost:11434";
    const spin = ora({ text: "  Mengecek Ollama…", prefixText: C.cyan("  │  "), color: "cyan" }).start();
    const models = await checkOllama(host);
    if (models === null) {
      spin.stop();
      row("Ollama", "Tidak dapat dijangkau", "error");
    } else {
      spin.stop();
      row("Ollama", `${C.green("Aktif")} — ${models.length} model tersedia`, "ok");
      const hasModel = models.includes(model);
      row("Model tersedia", hasModel ? C.green("Ya") : C.yellow("Tidak ditemukan"), hasModel ? "ok" : "warn");
    }
  }

  // ── Gateway ───────────────────────────────────────────────────────────────
  divider("GATEWAY");
  const tgEnabled = getEnv("TELEGRAM_GATEWAY") === "true";
  const tgToken   = getEnv("TELEGRAM_TOKEN_BOT");
  const waEnabled = getEnv("WA_GATEWAY") === "true";
  const waPhone   = getEnv("WA_PHONE_NUMBER");

  if (tgEnabled && tgToken) {
    const spin = ora({ text: "  Validasi token Telegram…", prefixText: C.cyan("  │  "), color: "cyan" }).start();
    const botInfo = await checkTelegramToken(tgToken);
    spin.stop();
    if (botInfo) {
      row("Telegram", `${C.green("Aktif")} — @${botInfo.username}`, "ok");
    } else {
      row("Telegram", C.red("Token tidak valid / offline"), "error");
    }
  } else {
    row("Telegram", "Nonaktif", "off");
  }

  if (waEnabled && waPhone) {
    const sessionPath = "./downloads/whatsapp";
    const hasSession  = fs.existsSync(path.join(sessionPath, "creds.json"));
    row("WhatsApp", `Dikonfigurasi — ${waPhone}${hasSession ? C.green(" (session tersimpan)") : C.yellow(" (belum pairing)")}`, waEnabled ? "ok" : "warn");
  } else {
    row("WhatsApp", "Nonaktif", "off");
  }

  // ── Skills ────────────────────────────────────────────────────────────────
  divider("SKILLS");
  try {
    const skillDir = "./skill";
    if (fs.existsSync(skillDir)) {
      const skills = fs.readdirSync(skillDir, { withFileTypes: true }).filter(d => d.isDirectory());
      row("Total skill", String(skills.length), skills.length > 0 ? "ok" : "warn");
      skills.slice(0, 6).forEach(s => {
        let desc = "";
        try { desc = JSON.parse(fs.readFileSync(path.join(skillDir, s.name, "meta.json"), "utf8")).description?.slice(0, 50) + "…" || ""; } catch {}
        row(s.name, C.dim(desc || "—"), "ok");
      });
      if (skills.length > 6) row("", C.dim(`… dan ${skills.length - 6} skill lainnya`), "ok");
    } else {
      row("Skill", "Folder tidak ditemukan", "warn");
    }
  } catch { row("Skill", "Gagal membaca", "error"); }

  // ── Memory / Sessions ─────────────────────────────────────────────────────
  divider("MEMORY & SESSIONS");
  try {
    const memDir = "./memory";
    if (fs.existsSync(memDir)) {
      const files   = fs.readdirSync(memDir).filter(f => f.endsWith(".json") && !f.startsWith("sessions.meta"));
      const metaPath = path.join(memDir, "sessions.meta.json");
      const hasMeta  = fs.existsSync(metaPath);
      row("Session files", `${files.length} tersimpan`, files.length > 0 ? "ok" : "off");
      if (hasMeta) {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        row("Named sessions",  String(Object.keys(meta).length), "ok");
      }
    } else {
      row("Memory", "Folder belum ada", "warn");
    }
  } catch { row("Memory", "Gagal membaca", "error"); }

  // ── Web UI ────────────────────────────────────────────────────────────────
  divider("WEB UI");
  const webuiEnabled = getEnv("WEBUI") === "true";
  const webuiPort    = getEnv("WEBUI_PORT") || "5090";
  const distExists   = fs.existsSync("./webui/dist");
  row("Web UI",   webuiEnabled ? C.green("Dikonfigurasi") : "Nonaktif", webuiEnabled ? "ok" : "off");
  if (webuiEnabled) {
    row("Port",   webuiPort, "ok");
    row("Built",  distExists ? C.green("Ya") : C.yellow("Belum — jalankan: npm run webui:build"), distExists ? "ok" : "warn");
  }

  footer();
}
