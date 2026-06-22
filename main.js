import "dotenv/config";
import crypto from "crypto";
import readline from "readline/promises";
import fs from "fs";
import path from "path";

import chalk from "chalk";
import boxen from "boxen";
import figlet from "figlet";
import ora from "ora";

import { ChatOpenAI } from "@langchain/openai";
import tools from "./core/tools.js";
import { ask, buildSkillCatalogForCLI } from "./core/chat.js";
import { handleCommand } from "./core/cmd.js";
import { eventBus } from "./utils/eventBus.js";
import { activeGateways } from "./gateway/index.js";

// ─────────────────────────────────────────────
// LLM INIT
// ─────────────────────────────────────────────
const llm = new ChatOpenAI({
  apiKey: process.env.MODEL_API || "ollama",
  model: process.env.MODEL_NAME,
  configuration: { baseURL: process.env.MODEL_URL },
  temperature: 0.2,
  maxTokens: 2048,
}).bindTools(tools, { toolChoice: "auto" });

const state = { currentSession: crypto.randomUUID() };

const WEB_MODE =
  process.env.WEBUI === "true" ||
  process.env.npm_config_web === "true" ||
  process.argv.includes("--web");

// ─────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────
const C = {
  // backgrounds/borders — pakai chalk.hex
  bg:      chalk.hex("#0d1117"),
  border:  chalk.hex("#30363d"),

  // text roles
  primary:   chalk.hex("#e6edf3"),
  secondary: chalk.hex("#8b949e"),
  muted:     chalk.hex("#6e7681"),

  // accents
  cyan:   chalk.hex("#58a6ff"),
  green:  chalk.hex("#3fb950"),
  yellow: chalk.hex("#d29922"),
  purple: chalk.hex("#a371f7"),
  pink:   chalk.hex("#f778ba"),
  red:    chalk.hex("#f85149"),

  // semantic
  success: chalk.hex("#2ea043"),
  error:   chalk.hex("#f85149"),
  warn:    chalk.hex("#d29922"),

  // combos
  bold:  chalk.bold,
  dim:   chalk.dim,
  reset: chalk.reset,
};


// ─────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────

/** Satu baris separator penuh lebar terminal */
function separator(char = "─", color = C.border) {
  const w = Math.min(process.stdout.columns || 80, 88);
  return color(char.repeat(w));
}

/** Box tanpa dep boxen untuk blok yang butuh warna fleksibel */
function thinBox(lines, { title = "", color = C.muted } = {}) {
  const w = Math.min(process.stdout.columns || 80, 88) - 2;
  const top = color("╭") + (title
    ? color("─") + C.cyan.bold(` ${title} `) + color("─".repeat(w - title.length - 3)) + color("╮")
    : color("─".repeat(w)) + color("╮")
  );
  const bottom = color("╰") + color("─".repeat(w)) + color("╯");
  const rows = lines.map(
    (l) => color("│") + " " + l + " ".repeat(Math.max(0, w - stripAnsi(l).length - 1)) + color("│")
  );
  return [top, ...rows, bottom].join("\n");
}

/** Strip ANSI escape codes buat hitung panjang string sebenarnya */
function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, "");
}

/** Kolom kiri/kanan rata dalam satu baris */
function cols(left, right, totalWidth = 86) {
  const lLen = stripAnsi(left);
  const rLen = stripAnsi(right);
  const pad = Math.max(0, totalWidth - lLen.length - rLen.length);
  return left + " ".repeat(pad) + right;
}

// ─────────────────────────────────────────────
// BANNER
// ─────────────────────────────────────────────
async function showBanner() {
  console.clear();

  // ── ASCII art logo ──────────────────────────────────────────────────────
  const raw = figlet.textSync("EMORA", { font: "ANSI Shadow" });
  // gradient cyan→purple lewat per-line coloring (chalk gak support gradient
  // native, simulasikan dengan alternating hue per baris)
  const logoLines = raw.split("\n");
  const gradient = [
    chalk.hex("#58a6ff"), chalk.hex("#6aabff"), chalk.hex("#7db0f7"),
    chalk.hex("#9299f7"), chalk.hex("#a371f7"),
  ];
  logoLines.forEach((line, i) => {
    if (line.trim()) console.log(gradient[i % gradient.length].bold(line));
  });

  // ── tagline + badge ──────────────────────────────────────────────────────
  const tagline = C.secondary("Autonomous AI Agent  ·  self-hosted  ·  multi-platform");
  const badge   = C.green("● ") + C.success("running");
  const s = C.secondary(`Model:  · ${process.env.MODEL_NAME}   ·  API ${process.env.MODEL_API}`);
  console.log("\n" + " ".repeat(4) + tagline);
  console.log("\n" + " ".repeat(4) + s);
  console.log(" ".repeat(4) + badge + "\n");

  console.log(separator());

  // ── Gateway + session info ────────────────────────────────────────────────
  const tgStatus = process.env.TELEGRAM_GATEWAY === "true"
    ? C.green("●") + " " + C.success("Telegram Gateway")
    : C.muted("○") + " " + C.muted("Telegram Gateway");

  const waStatus = process.env.WA_GATEWAY === "true"
    ? C.green("●") + " " + C.success("WhatsApp Gateway")
    : C.muted("○") + " " + C.muted("WhatsApp Gateway");

  const webStatus = WEB_MODE
    ? C.green("●") + " " + C.success(`Web UI  `) + C.muted(`http://localhost:${process.env.WEBUI_PORT || 5090}`)
    : C.muted("○") + " " + C.muted("Web UI") + "  " + C.muted("npm start --web");

  const model    = C.muted("Model ") + C.cyan(process.env.MODEL_NAME || "—");
  const sesLabel = C.muted("Session ") + C.green(state.currentSession.slice(0, 8)) + C.muted(`…${state.currentSession.slice(-4)}`);

  const statusLines = [tgStatus, waStatus, webStatus, model, sesLabel];
  statusLines.forEach((l) => console.log("  " + l));

  console.log("\n" + separator());

  // ── Skill catalog (baca dari disk, ringkas) ──────────────────────────────
  let skillLines = [];
  try {
    const skillDir = path.resolve("./skill");
    if (fs.existsSync(skillDir)) {
      const dirs = fs.readdirSync(skillDir, { withFileTypes: true })
        .filter((e) => e.isDirectory());

      if (dirs.length) {
        skillLines.push(C.cyan.bold("  AVAILABLE SKILLS") + C.muted(`  (${dirs.length} loaded)`));
        const cols3 = Math.floor(dirs.length / 3) + 1;
        for (let i = 0; i < dirs.length; i += 3) {
          const row = [dirs[i], dirs[i + 1], dirs[i + 2]]
            .filter(Boolean)
            .map((d) => C.green("  ▸ ") + C.primary(d.name.padEnd(28)))
            .join("");
          skillLines.push(row);
        }
      }
    }
  } catch { /* skill dir belum ada */ }

  if (skillLines.length) {
    console.log();
    skillLines.forEach((l) => console.log(l));
  }

  // ── Help cheat-sheet ─────────────────────────────────────────────────────
  console.log("\n" + separator());
  console.log();

  const cmds = [
    ["/new",               "Buat sesi baru",                  "session"],
    ["/sesi",              "Lihat sesi aktif",                "session"],
    ["/sesi <uuid>",       "Pindah ke sesi tertentu",         "session"],
    ["/sesilist",          "Daftar semua sesi",               "session"],
    ["/sesiinfo <uuid>",   "Detail info satu sesi",           "session"],
    ["/sesidel <uuid>",    "Hapus satu sesi",                 "session"],
    ["/clear",             "Hapus sesi aktif + mulai baru",   "danger" ],
    ["/help",              "Tampilkan bantuan ini lagi",       "info"   ],
    ["/exit",              "Keluar dari EMORA",               "danger" ],
  ];

  const catColor = { session: C.cyan, danger: C.red, info: C.yellow };

  console.log("  " + C.secondary.bold("COMMAND") + " ".repeat(22) + C.secondary.bold("DESCRIPTION") + " ".repeat(20) + C.secondary.bold("TAG"));
  console.log("  " + C.border("─".repeat(64)));

  for (const [cmd, desc, tag] of cmds) {
    const cmdStr  = C.green.bold(cmd.padEnd(26));
    const descStr = C.primary(desc.padEnd(34));
    const tagStr  = (catColor[tag] || C.muted)(tag);
    console.log("  " + cmdStr + descStr + tagStr);
  }

  console.log("\n" + separator() + "\n");
}

// ─────────────────────────────────────────────
// PRINT AI REPLY
// ─────────────────────────────────────────────
function printAI(text) {
  console.log();
  // Header baris
  console.log(
    C.cyan.bold("  ╭─ ") + C.purple.bold("EMORA") + C.cyan.bold(" ─────────────────────────────────────────────")
  );
  // Konten — tiap baris diindentasi & wrap sederhana
  const maxW = Math.min(process.stdout.columns || 80, 84) - 6;
  const lines = [];
  for (const rawLine of text.split("\n")) {
    if (stripAnsi(rawLine).length <= maxW) {
      lines.push(rawLine);
    } else {
      // soft-wrap baris panjang
      const words = rawLine.split(" ");
      let cur = "";
      for (const w of words) {
        if ((cur + " " + w).trim().length > maxW) {
          lines.push(cur.trim());
          cur = w;
        } else {
          cur += (cur ? " " : "") + w;
        }
      }
      if (cur) lines.push(cur.trim());
    }
  }
  lines.forEach((l) => {
    const plain = stripAnsi(l);
    // Sintaks highlight sederhana:
    // - code inline `...` → cyan
    // - **bold** → bold white
    // - #heading → cyan bold
    let out = l;
    if (plain.startsWith("#")) out = C.cyan.bold(l);
    out = out.replace(/`([^`]+)`/g, (_, c) => C.cyan("`" + c + "`"));
    out = out.replace(/\*\*([^*]+)\*\*/g, (_, c) => chalk.bold.white(c));
    console.log(C.cyan("  │ ") + out);
  });
  console.log(C.cyan.bold("  ╰────────────────────────────────────────────────────────────"));
  console.log();
}

// ─────────────────────────────────────────────
// PRINT COMMAND REPLY (system info dari /help, /sesilist, dll)
// ─────────────────────────────────────────────
function printSystem(text, { isError = false, isExit = false } = {}) {
  const accentFn = isError ? C.red : isExit ? C.yellow : C.cyan;
  const label    = isError ? "ERROR" : isExit ? "EXIT" : "SYSTEM";

  console.log();
  console.log(
    accentFn.bold(`  ╭─ ${label} `) + accentFn("─".repeat(Math.max(0, 60 - label.length - 4)))
  );
  text.split("\n").forEach((l) => {
    console.log(accentFn("  │ ") + (isError ? C.error(l) : C.primary(l)));
  });
  console.log(accentFn.bold("  ╰" + "─".repeat(64)));
  console.log();
}

// ─────────────────────────────────────────────
// PRINT HELP PANEL  (desain diselaraskan dengan cli.html help-box)
// ─────────────────────────────────────────────
function printHelp() {
  console.log();
  const w = Math.min(process.stdout.columns || 80, 88);
  const line = C.border("─".repeat(w));

  // Header
  console.log(C.cyan.bold("  ╭─ EMORA COMMANDS ") + C.cyan("─".repeat(w - 21)) );

  // Sections
  const sections = [
    {
      title: "SESSION MANAGEMENT",
      items: [
        ["/new",             "Buat sesi baru",                   "session"],
        ["/sesi",           "Tampilkan sesi aktif saat ini",     "session"],
        ["/sesi <uuid>",    "Pindah ke sesi berdasarkan UUID",   "session"],
        ["/sesilist",       "Daftar semua sesi tersimpan",       "session"],
        ["/sesiinfo <uuid>","Detail info satu sesi",             "session"],
        ["/sesidel <uuid>", "Hapus satu sesi beserta memorinya", "danger" ],
        ["/clear",          "Hapus sesi aktif + mulai baru",     "danger" ],
      ],
    },
    {
      title: "GENERAL",
      items: [
        ["/help",  "Tampilkan panel bantuan ini",  "info"  ],
        ["/exit",  "Keluar dari EMORA",            "danger"],
      ],
    },
  ];

  const tagColor = { session: C.cyan, danger: C.red, info: C.yellow };

  for (const sec of sections) {
    console.log(C.cyan("  │"));
    console.log(C.cyan("  │  ") + C.purple.bold(sec.title));
    console.log(C.cyan("  │  ") + C.border("─".repeat(60)));
    for (const [cmd, desc, tag] of sec.items) {
      const cmdStr  = C.green.bold(cmd.padEnd(24));
      const descStr = C.secondary(desc.padEnd(36));
      const tagStr  = (tagColor[tag] || C.muted)(tag);
      console.log(C.cyan("  │  ") + cmdStr + descStr + tagStr);
    }
  }

  console.log(C.cyan("  │"));
  console.log(C.cyan("  │  ") + C.muted("Tip: Ketik pesan biasa untuk ngobrol dengan Emora."));
  console.log(C.cyan("  │  ") + C.muted("     Tool call, skill execution, dan memory berjalan otomatis."));
  console.log(C.cyan.bold("  ╰" + "─".repeat(w - 3)));
  console.log();
}

// ─────────────────────────────────────────────
// BACKGROUND TASK HANDLER
// ─────────────────────────────────────────────
const bgLocks = {};

eventBus.on("execute_bg_task", async ({ job_id, session_id, prompt }) => {
  if (bgLocks[job_id]) return;
  bgLocks[job_id] = true;

  try {
    const bgSessionId = `${session_id}_bg_${job_id}`;
    const result = await ask(llm, tools, bgSessionId, `[BACKGROUND TASK] ${prompt}`);

    if (!result.includes("SILENT_ABORT")) {
      // Tulis notif di baris baru, jangan ganggu input readline yang sedang aktif
      process.stdout.write("\r\x1B[K"); // hapus baris prompt saat ini
      console.log();
      console.log(
        C.yellow.bold("  ╭─ 🔔 NOTIFIKASI BACKGROUND ") + C.yellow("─".repeat(33))
      );
      result.split("\n").forEach((l) => console.log(C.yellow("  │ ") + C.primary(l)));
      console.log(C.yellow.bold("  ╰" + "─".repeat(62)));
      console.log();

      // Kembalikan prompt
      process.stdout.write(buildPrompt());
    }
  } catch (err) {
    process.stdout.write("\r\x1B[K");
    console.log(C.error(`\n  [BG ERROR] Job ${job_id}: ${err.message}\n`));
    process.stdout.write(buildPrompt());
  } finally {
    bgLocks[job_id] = false;
  }
});

// ─────────────────────────────────────────────
// PROMPT STRING
// ─────────────────────────────────────────────
function buildPrompt() {
  return (
    C.muted("[") +
    C.green(state.currentSession.slice(0, 8)) +
    C.muted("] ") +
    C.cyan.bold("You") +
    C.muted(" ❯ ")
  );
}

// ─────────────────────────────────────────────
// WEB UI
// ─────────────────────────────────────────────
if (WEB_MODE) {
  import("./webui/server.js").catch((err) => {
    console.error(C.error(`\n  [WEBUI ERROR] Gagal menjalankan Web UI: ${err.message}\n`));
  });
}

// ─────────────────────────────────────────────
// MAIN CHAT LOOP
// ─────────────────────────────────────────────
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function runChat() {
  await showBanner();

  while (true) {
    let input;
    try {
      input = await rl.question(buildPrompt());
    } catch {
      // Ctrl+D → EOF
      printSystem("Terima kasih telah menggunakan EMORA. Sampai jumpa! 👋", { isExit: true });
      process.exit(0);
    }

    input = input.trim();
    if (!input) continue;

    // ── Slash commands ────────────────────────────────────────────────────
    const commandResult = await handleCommand(input, state);

    if (commandResult) {
      if (commandResult.action === "exit") {
        printSystem(commandResult.message, { isExit: true });
        rl.close();
        process.exit(0);
      }
      if (commandResult.action === "help") {
        printHelp();
        continue;
      }
      if (commandResult.action === "reply") {
        printSystem(commandResult.message);
      }
      continue;
    }

    // ── AI turn ───────────────────────────────────────────────────────────
    const spinner = ora({
      text: C.muted("  Emora sedang berpikir…"),
      spinner: "dots",
      color: "cyan",
      prefixText: C.cyan("  →"),
    }).start();

    try {
      const result = await ask(llm, tools, state.currentSession, input);
      spinner.stop();
      printAI(result);
    } catch (err) {
      spinner.fail(C.error("  Terjadi kesalahan."));
      const msg = err?.message || err?.error?.message || "Kesalahan tidak diketahui.";
      printSystem(msg, { isError: true });
    }
  }
}

runChat();
