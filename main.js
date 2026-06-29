/**
 * main.js — EMORA CLI Agent
 * Desain mengacu screenshot referensi: tool bullets, clean response header,
 * status bar, autocomplete di bawah prompt.
 */

import "dotenv/config";
import crypto   from "crypto";
import fs       from "fs";

import chalk  from "chalk";
import figlet from "figlet";

import { createLLM, getProviderMeta } from "./provider/index.js";
import tools                          from "./core/tools.js";
import { ask }                        from "./core/chat.js";
import { handleCommand }              from "./core/cmd.js";
import { eventBus }                   from "./utils/eventBus.js";

// ═══════════════════════════════════════════════════════════════════════
// COLOR TOKENS  (sesuai permintaan)
// ═══════════════════════════════════════════════════════════════════════
const dim    = chalk.hex("#6e7681");
const cyan   = chalk.hex("#58a6ff");
const green  = chalk.hex("#3fb950");
const yellow = chalk.hex("#d29922");
const muted  = chalk.hex("#8b949e");
const bold   = chalk.bold;

// Tambahan yang dibutuhkan
const red    = chalk.hex("#f85149");
const purple = chalk.hex("#a371f7");
const white  = chalk.hex("#e6edf3");

// ═══════════════════════════════════════════════════════════════════════
// TERMINAL HELPERS
// ═══════════════════════════════════════════════════════════════════════
const W          = () => Math.min(process.stdout.columns || 80, 110);
const SEP        = (c = dim)  => c("─".repeat(W()));
const stripAnsi  = (s) => String(s).replace(/\x1B\[[0-9;]*m/g, "");
const clearLines = (n) => { for (let i = 0; i < n; i++) process.stdout.write("\x1B[1A\x1B[2K"); };
const write      = (s) => process.stdout.write(s);

function pad(str, len) {
  const raw = stripAnsi(str);
  return raw.length >= len ? str : str + " ".repeat(len - raw.length);
}

// ═══════════════════════════════════════════════════════════════════════
// SESSION STATE
// ═══════════════════════════════════════════════════════════════════════
const sessionStart = Date.now();
const state        = { currentSession: crypto.randomUUID() };

let lastResponseMs = 0;
let totalChars     = 0;
let msgCount       = 0;

// const WEB_MODE =
//   process.env.WEBUI === "true" ||
//   process.env.npm_config_web === "true" ||
//   process.argv.includes("--web");

// ═══════════════════════════════════════════════════════════════════════
// LLM INIT
// ═══════════════════════════════════════════════════════════════════════
let llm;
try {
  llm = await createLLM(tools);
} catch (err) {
  console.error(red(`\n  ✗ Gagal init LLM: ${err.message}`));
  console.error(yellow("  Jalankan: emora setup  atau  emora model\n"));
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════
// SLASH COMMANDS REGISTRY
// ═══════════════════════════════════════════════════════════════════════
const SLASH_COMMANDS = [
  { cmd: "/new",       desc: "Mulai sesi baru (session ID + history baru)"        },
  { cmd: "/clear",     desc: "Hapus sesi aktif dan mulai sesi baru"               },
  { cmd: "/sesi",      desc: "Tampilkan session ID yang sedang aktif"             },
  { cmd: "/sesilist",  desc: "Lihat semua sesi yang tersimpan"                    },
  { cmd: "/sesiinfo",  desc: "Detail info sesi — /sesiinfo <uuid>"                },
  { cmd: "/sesidel",   desc: "Hapus satu sesi  — /sesidel <uuid>"                },
  { cmd: "/help",      desc: "Tampilkan daftar semua command"                     },
  { cmd: "/exit",      desc: "Keluar dari EMORA"                                  },
];

// ═══════════════════════════════════════════════════════════════════════
// STATUS BAR
// ═══════════════════════════════════════════════════════════════════════
function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60)  return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

function progressBar(pct, w = 8) {
  const filled = Math.max(0, Math.min(w, Math.round((pct / 100) * w)));
  return (
    dim("[") +
    cyan("█".repeat(filled)) +
    dim("░".repeat(w - filled)) +
    dim("]")
  );
}

function renderStatusBar() {
  const prov    = getProviderMeta();
  const model   = `${prov.label.toLowerCase().replace(/\s+/g, "-")}:${process.env.MODEL_NAME || "—"}`;
  const ctxMax  = 400_000;             // ~100K tokens * 4 chars
  const pct     = Math.min(100, Math.round((totalChars / ctxMax) * 100));
  const charsK  = totalChars > 999 ? `${(totalChars / 1000).toFixed(1)}K` : `${totalChars}`;
  const limitK  = `${Math.round(ctxMax / 1000)}K`;
  const uptime  = formatTime(Date.now() - sessionStart);
  const lastR   = lastResponseMs ? `⊙ ${formatTime(lastResponseMs)}` : "⊙ —";
  const msgs    = `${msgCount} msg`;

  const parts = [
    yellow.bold(`$ ${model}`),
    muted(`${charsK}/${limitK}`),
    progressBar(pct) + " " + dim(`${pct}%`),
    dim(uptime),
    muted(lastR),
    dim(`✓ ${msgs}`),
  ];

  // Compact: join with dim " | " separator, truncate if terminal too narrow
  const line = parts.join(dim(" | "));
  const raw  = stripAnsi(line);
  if (raw.length <= W()) {
    console.log(line);
  } else {
    // Too long: drop last parts
    console.log(parts.slice(0, 4).join(dim(" | ")));
  }
}

// ═══════════════════════════════════════════════════════════════════════
// BANNER
// ═══════════════════════════════════════════════════════════════════════
async function showBanner() {
  console.clear();

  const gradient = [
    chalk.hex("#58a6ff"), chalk.hex("#6aabff"),
    chalk.hex("#7db0f7"), chalk.hex("#9299f7"), chalk.hex("#a371f7"),
  ];
  figlet.textSync("EMORA", { font: "ANSI Shadow" })
    .split("\n")
    .forEach((l, i) => { if (l.trim()) console.log(gradient[i % gradient.length].bold(l)); });

  console.log();
  console.log(SEP());
  console.log();

  // Info grid
  const prov = getProviderMeta();
  const rows = [
    [dim("provider  "), yellow.bold(prov.label)],
    [dim("model     "), cyan(process.env.MODEL_NAME || "—")],
    [dim("session   "), green(state.currentSession.slice(0, 8)) + dim("…") + green(state.currentSession.slice(-4))],
    [dim("gateway   "),
      (process.env.TELEGRAM_GATEWAY === "true" ? green("Telegram") : dim("Telegram")) +
      dim("  ·  ") +
      (process.env.WA_GATEWAY === "true" ? green("WhatsApp") : dim("WhatsApp"))
    ],
  ];
  rows.forEach(([k, v]) => console.log("  " + k + v));

  // Skills inline
  try {
    const skills = fs.readdirSync("./skill", { withFileTypes: true }).filter(d => d.isDirectory());
    if (skills.length) {
      console.log();
      write("  " + dim("skills    "));
      const names = skills.map(s => muted(s.name));
      let line = "", count = 0;
      for (const n of names) {
        const sep   = count > 0 ? dim("  ·  ") : "";
        const try1  = stripAnsi(line + stripAnsi(sep) + stripAnsi(n));
        if (try1.length > W() - 12) { console.log(line); write("  " + " ".repeat(10)); line = n; }
        else { line += sep + n; }
        count++;
      }
      if (line) console.log(line);
    }
  } catch {}

  // Library summary (import dilakukan di luar try agar tidak error di node --check)
  try {
    const libMod  = await import("./library/index.js");
    const topics   = libMod.listTopics();
    const catalog  = libMod.loadIndex();
    const tkeys    = Object.keys(topics);
    if (tkeys.length) {
      write(
        "  " + dim("library   ") +
        muted(`${catalog.count} docs`) +
        dim("  ·  ") +
        tkeys.map(t => muted(t)).join(dim("  ·  "))
      );
      console.log();
    }
  } catch {}

  console.log();
  console.log(SEP());
  console.log();
  console.log(dim("  Ketik pesan untuk mulai · ketik ") + cyan("/") + dim(" untuk melihat semua command"));
  console.log();
}

// ═══════════════════════════════════════════════════════════════════════
// THINKING DISPLAY  — spinner ringan, Termux-safe
// ═══════════════════════════════════════════════════════════════════════
const THINKING = [
  "memikirkan jawaban",
  "sedang analisa",
  "meramu respons",
  "menghubungkan titik-titik",
  "memproses konteks",
  "memformulasikan jawaban",
  "nyusun pemikiran",
  "menelaah permintaan",
];

function startThinking() {
  const t0      = Date.now();
  let   phraseI = Math.floor(Math.random() * THINKING.length);
  let   active  = true;
  const events  = [];

  // Initial line
  write(dim("  ◆ ") + muted(THINKING[phraseI] + "...") + "  " + dim("0.0s") + "\n");

  const tick = setInterval(() => {
    if (!active) return;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    // Phrase rotates every 3s
    const newPhrase = THINKING[Math.floor((Date.now() - t0) / 3000) % THINKING.length];
    // Rewrite same line
    write("\x1B[1A\x1B[2K");
    write(dim("  ◆ ") + muted(newPhrase + "...") + "  " + dim(elapsed + "s") + "\n");
  }, 200);

  function logEvent(formatted) {
    // Remove thinking line, print event, restore thinking line
    write("\x1B[1A\x1B[2K");
    console.log(formatted);
    write(dim("  ◆ ") + muted(THINKING[phraseI] + "...") + "\n");
  }

  function stop() {
    active = false;
    clearInterval(tick);
    write("\x1B[1A\x1B[2K"); // erase thinking line
    return Date.now() - t0;
  }

  return { logEvent, stop };
}

// ═══════════════════════════════════════════════════════════════════════
// TOOL / SKILL EVENT FORMATTER
// ═══════════════════════════════════════════════════════════════════════
const TOOL_LABELS = {
  shell_exec:      "shell",
  read_file:       "read",
  write_file:      "write",
  list_files:      "ls",
  search_web:      "search",
  fetch_page:      "fetch",
  git_manager:     "git",
  backup_manager:  "backup",
  scheduler:       "scheduler",
  project_manager: "project",
  system_monitor:  "sysmon",
  group_manager:   "group",
  skill_factory:   "skill factory",
  zip_compress:    "zip",
  zip_extract:     "unzip",
  create_folder:   "mkdir",
  delete_folder:   "rmdir",
  search_text:     "grep",
  find_folder:     "find",
  economy_manager: "economy",
  emora_hub:       "hub",
  datetime:        "datetime",
};

// ═══════════════════════════════════════════════════════════════════════
// PRINT AI RESPONSE  — matches screenshot style
// ═══════════════════════════════════════════════════════════════════════
function printResponse(text, durationMs) {
  const agentName = process.env.NAME || "Emora";
  totalChars += text.length;
  msgCount++;
  lastResponseMs = durationMs;

  // Header: — AgentName ────────────────────────
  const headerMid  = `  ${dim("—")} ${green(agentName)} `;
  const headerFill = dim("─".repeat(Math.max(0, W() - stripAnsi(headerMid).length)));
  console.log(headerMid + headerFill);
  console.log();

  const maxW = W() - 4;

  for (const rawLine of text.split("\n")) {
    if (!rawLine.trim()) { console.log(); continue; }

    // Detect markdown
    const isH = /^#{1,3} /.test(rawLine);
    const isBullet = /^\s*[-•*▸]\s/.test(rawLine);
    const isCode = rawLine.startsWith("    ") || rawLine.startsWith("\t");

    // Word-wrap (based on plain text width)
    const words = rawLine.split(" ");
    const wrapped = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (test.length > maxW) { if (cur) wrapped.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) wrapped.push(cur);

    for (const line of wrapped) {
      let out = line;
      if (isH)     { out = cyan.bold(line); }
      else if (isCode) { out = dim(line); }
      else {
        out = out.replace(/`([^`]+)`/g,    (_, c) => cyan("`" + c + "`"));
        out = out.replace(/\*\*([^*]+)\*\*/g, (_, c) => bold(white(c)));
        if (isBullet) out = dim("  ") + out;
      }
      console.log("  " + out);
    }
  }

  console.log();
  // Footer timing
  if (durationMs) {
    const durStr = (durationMs / 1000).toFixed(1) + "s";
    console.log(dim(`  ✓ ${durStr}`));
  }
  console.log();
}

// ═══════════════════════════════════════════════════════════════════════
// PRINT SYSTEM MESSAGE  (commands, errors)
// ═══════════════════════════════════════════════════════════════════════
function printSystem(text, { isError = false, isExit = false } = {}) {
  const icon  = isError ? red("  ✗ ") : isExit ? yellow("  → ") : dim("  ℹ ");
  const color = isError ? red : isExit ? yellow : muted;
  console.log();
  text.split("\n").forEach(l => console.log(icon + color(l)));
  console.log();
}

// ═══════════════════════════════════════════════════════════════════════
// PRINT HELP TABLE
// ═══════════════════════════════════════════════════════════════════════
function printHelp() {
  console.log();
  console.log(SEP());
  SLASH_COMMANDS.forEach(({ cmd, desc }) => {
    console.log(
      cyan(pad(cmd, 14)) +
      dim("  ") +
      muted(desc)
    );
  });
  console.log(SEP());
  console.log();
}

// ═══════════════════════════════════════════════════════════════════════
// INPUT ENGINE — raw mode + "/" autocomplete below prompt
// ═══════════════════════════════════════════════════════════════════════

/**
 * Render prompt + optional autocomplete list.
 * Returns number of lines printed (for clearing on next key).
 */
function renderInputArea(buf, completions = null) {
  let lines = 0;

  // Status bar
  renderStatusBar();
  lines++;

  // Prompt line
  write(dim("> ") + (buf ? yellow(buf) : "") + "\n");
  lines++;

  // Autocomplete list (if "/" mode)
  if (completions !== null) {
    write(SEP() + "\n");
    lines++;
    for (const { cmd, desc, selected } of completions) {
      const cmdStr  = selected ? cyan.bold(pad(cmd, 16)) : white(pad(cmd, 16));
      const descStr = selected ? white(desc) : dim(desc);
      write(cmdStr + "  " + descStr + "\n");
      lines++;
    }
  }

  return lines;
}

function readInput() {
  return new Promise((resolve) => {
    let buf      = "";
    let slashMode = false;
    let selIdx   = -1;      // -1 = no selection (typing)
    let renderedLines = 0;

    function filtered() {
      const q = buf.slice(1).toLowerCase();   // after "/"
      return SLASH_COMMANDS.filter(c =>
        !q || c.cmd.slice(1).startsWith(q) || c.desc.toLowerCase().includes(q)
      );
    }

    function buildCompletions(idx) {
      if (!slashMode) return null;
      return filtered().map((c, i) => ({ ...c, selected: i === idx }));
    }

    function render() {
      // Clear previous render
      clearLines(renderedLines);
      const comps = buildCompletions(selIdx);
      renderedLines = renderInputArea(buf, comps);
    }

    // Initial render
    render();

    // Raw mode
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");

    function cleanup() {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.removeListener("data", onKey);
    }

    async function onKey(key) {
      // Ctrl+C
      if (key === "\x03") {
        cleanup();
        clearLines(renderedLines);
        resolve(null); // null = cancelled, will ask again
        return;
      }

      // Ctrl+D
      if (key === "\x04") {
        cleanup();
        clearLines(renderedLines);
        printSystem("Sampai jumpa! 👋", { isExit: true });
        process.exit(0);
      }

      // Enter
      if (key === "\r" || key === "\n") {
        // If selection active, use it
        if (slashMode && selIdx >= 0) {
          const chosen = filtered()[selIdx];
          if (chosen) {
            cleanup();
            clearLines(renderedLines);
            // If no-arg command, submit directly
            const noArg = ["/new","/sesilist","/help","/exit","/clear","/sesi"];
            if (noArg.includes(chosen.cmd)) {
              resolve(chosen.cmd);
            } else {
              buf = chosen.cmd + " ";
              slashMode = false; selIdx = -1;
              renderedLines = 0;
              render();
              // Continue typing
            }
            return;
          }
        }
        cleanup();
        clearLines(renderedLines);
        resolve(buf.trim());
        return;
      }

      // Backspace
      if (key === "\x7F" || key === "\b") {
        buf = buf.slice(0, -1);
        slashMode = buf.startsWith("/");
        if (!slashMode) selIdx = -1;
        render();
        return;
      }

      // Escape → clear
      if (key === "\x1B" && !key.startsWith("\x1B[")) {
        buf = ""; slashMode = false; selIdx = -1;
        render();
        return;
      }

      // Arrow keys
      if (key === "\x1B[A") {  // Up
        if (slashMode) {
          const f = filtered();
          if (selIdx <= 0) selIdx = f.length - 1;
          else selIdx--;
          render();
        }
        return;
      }
      if (key === "\x1B[B") {  // Down
        if (slashMode) {
          const f = filtered();
          selIdx = (selIdx + 1) % f.length;
          render();
        }
        return;
      }
      if (key === "\x1B[C" || key === "\x1B[D") return; // Left/Right: ignore

      // Tab → autocomplete first match
      if (key === "\t") {
        if (slashMode) {
          const f = filtered();
          if (f.length === 1) {
            buf = f[0].cmd + " ";
            slashMode = false; selIdx = -1;
          } else if (selIdx >= 0 && f[selIdx]) {
            buf = f[selIdx].cmd + " ";
            slashMode = false; selIdx = -1;
          }
          render();
        }
        return;
      }

      // Ignore other escape sequences
      if (key.startsWith("\x1B")) return;

      // Normal char
      buf += key;
      if (buf === "/") { slashMode = true; selIdx = -1; }
      else if (!buf.startsWith("/")) slashMode = false;
      else slashMode = true;

      render();
    }

    process.stdin.on("data", onKey);
  });
}

// ═══════════════════════════════════════════════════════════════════════
// BACKGROUND TASK
// ═══════════════════════════════════════════════════════════════════════
const bgLocks = {};

eventBus.on("execute_bg_task", async ({ job_id, session_id, prompt }) => {
  if (bgLocks[job_id]) return;
  bgLocks[job_id] = true;
  try {
    const bgSess = `${session_id}_bg_${job_id}`;
    const result = await ask(llm, tools, bgSess, `[BACKGROUND TASK] ${prompt}`);
    if (!result.includes("SILENT_ABORT")) {
      console.log();
      console.log(SEP(yellow));
      console.log(yellow("  🔔 Background Task: ") + dim(job_id));
      result.split("\n").forEach(l => console.log(dim("  ") + white(l)));
      console.log(SEP(yellow));
      console.log();
    }
  } catch (err) {
    console.log(red(`\n  ✗ [BG ${job_id}] ${err.message}\n`));
  } finally {
    bgLocks[job_id] = false;
  }
});

// ═══════════════════════════════════════════════════════════════════════
// WEB UI
// ═══════════════════════════════════════════════════════════════════════
// if (WEB_MODE) {
//   import("./webui/server.js").catch(err =>
//     console.error(red(`\n  ✗ Web UI gagal: ${err.message}\n`))
//   );
// }

// ═══════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════
async function runChat() {
  await showBanner();

  while (true) {
    // Read user input (blocking, raw mode)
    const input = await readInput();

    // null = Ctrl+C, just loop again
    if (input === null) continue;
    if (!input)         continue;

    // ── Slash commands ──────────────────────────────────────────────
    const cmdResult = await handleCommand(input, state);
    if (cmdResult) {
      if (cmdResult.action === "exit") {
        printSystem(cmdResult.message, { isExit: true });
        process.exit(0);
      }
      if (cmdResult.action === "help") { printHelp(); continue; }
      if (cmdResult.action === "reply") { printSystem(cmdResult.message); continue; }
      continue;
    }

    // ── AI turn ─────────────────────────────────────────────────────
    msgCount++;
    totalChars += input.length;

    // Separator before response
    console.log();
    console.log(SEP());

    const thinking = startThinking();
    const toolCallTimers = new Map(); // name -> startMs

    try {
      const result = await ask(llm, tools, state.currentSession, input, {
        onEvent(ev) {
          let formatted = "";

          if (ev.type === "tool_use") {
            toolCallTimers.set(ev.name, Date.now());
            const label = TOOL_LABELS[ev.name] || ev.name;
            let detail = "";
            if (ev.args) {
              if (ev.args.command)      detail = dim("  " + String(ev.args.command).slice(0, 52));
              else if (ev.args.path)    detail = dim("  " + ev.args.path);
              else if (ev.args.query)   detail = dim(`  "${String(ev.args.query).slice(0, 40)}"`);
              else if (ev.args.action)  detail = dim("  " + ev.args.action);
              else if (ev.args.url)     detail = dim("  " + String(ev.args.url).slice(0, 50));
            }
            formatted = green("  ● ") + white(label) + detail;
            thinking.logEvent(formatted);

          } else if (ev.type === "tool_result") {
            const startMs = toolCallTimers.get(ev.name);
            const dur     = startMs ? dim(`  ${((Date.now() - startMs) / 1000).toFixed(1)}s`) : "";
            toolCallTimers.delete(ev.name);
            const preview = ev.result ? String(ev.result).trim().split("\n")[0].slice(0, 64) : "";
            if (preview) {
              formatted = dim("  │ ") + dim("$ ") + muted(preview) + dur;
              thinking.logEvent(formatted);
            }

          } else if (ev.type === "skill_read") {
            formatted = purple("  ◈ ") + dim("reading skill ") + cyan.bold(ev.name);
            thinking.logEvent(formatted);
          }
        },
      });

      const durationMs = thinking.stop();
      printResponse(result, durationMs);

    } catch (err) {
      thinking.stop();
      printSystem(
        err?.message || "Terjadi kesalahan yang tidak diketahui.",
        { isError: true }
      );
    }
  }
}

runChat();
