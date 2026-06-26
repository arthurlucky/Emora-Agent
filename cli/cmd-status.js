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
  cyan:    chalk.hex("#58a6ff"),
  green:   chalk.hex("#3fb950"),
  yellow:  chalk.hex("#d29922"),
  red:     chalk.hex("#f85149"),
  purple:  chalk.hex("#a371f7"),
  muted:   chalk.hex("#8b949e"),
  dim:     chalk.hex("#6e7681"),
  primary: chalk.hex("#e6edf3"),
};


// Helper untuk chaining bold + color
const bold = (fn) => (t) => chalk.bold(fn(t));

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
    process.stdout.write(C.cyan("  │\n  │  ") + bold(C.purple)(title) + "\n");
    process.stdout.write(C.cyan("  │  ") + C.dim("─".repeat(w - 5)) + "\n");
  } else {
    process.stdout.write(C.cyan("  │\n"));
  }
}

function header(title) {
  const w = Math.min(process.stdout.columns || 80, 88);
  console.log();
  console.log(bold(C.cyan)("  ╭─ EMORA STATUS ") + C.dim("─".repeat(w - 19)));
  console.log(C.cyan("  │  ") + C.muted(new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })));
}

function footer() {
  const w = Math.min(process.stdout.columns || 80, 88);
  console.log(C.cyan("  │"));
  console.log(bold(C.cyan)("  ╰" + "─".repeat(w - 3)));
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

  // ── Knowledge Library ────────────────────────────────────────────────────
  divider("KNOWLEDGE LIBRARY");
  try {
    const libIdx = path.join(".", "library", ".index", "catalog.json");
    if (fs.existsSync(path.join(".", "library"))) {
      if (fs.existsSync(libIdx)) {
        const catalog = JSON.parse(fs.readFileSync(libIdx, "utf8"));
        const topics  = {};
        for (const e of catalog.entries || []) {
          if (!topics[e.topic]) topics[e.topic] = new Set();
          topics[e.topic].add(e.subtopic);
        }
        const topicCount = Object.keys(topics).length;
        row("Status",       C.green("Aktif"), "ok");
        row("Total docs",   String(catalog.count || 0), "ok");
        row("Total topics", String(topicCount), topicCount > 0 ? "ok" : "warn");
        Object.entries(topics).slice(0, 5).forEach(([topic, subs]) => {
          row(topic, `${subs.size} subtopic`, "ok");
        });
        if (Object.keys(topics).length > 5) {
          row("", C.dim(`… dan ${Object.keys(topics).length - 5} topik lainnya`), "ok");
        }
      } else {
        row("Status", C.yellow("Folder ada, index belum dibangun"), "warn");
      }
    } else {
      row("Status", "Belum ada", "off");
    }
  } catch (err) { row("Status", `Error: ${err.message}`, "error"); }

  // ── Backup Manager ────────────────────────────────────────────────────────
  divider("BACKUPS");
  try {
    const backupDir = "./backups";
    if (fs.existsSync(backupDir)) {
      const backups = fs.readdirSync(backupDir).filter(f => f.endsWith(".zip"));
      row("Total backup", String(backups.length), backups.length > 0 ? "ok" : "warn");
      if (backups.length > 0) {
        const sorted = backups
          .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtime }))
          .sort((a, b) => b.time - a.time)
          .slice(0, 3);
        sorted.forEach(b => {
          const size = fs.statSync(path.join(backupDir, b.name)).size;
          const sizeStr = size > 1024*1024 ? `${(size/(1024*1024)).toFixed(1)} MB` : `${(size/1024).toFixed(1)} KB`;
          row(b.name, sizeStr, "ok");
        });
      }
    } else {
      row("Backups", "Folder belum ada", "off");
    }
  } catch { row("Backups", "Gagal membaca", "error"); }

  footer();
}
