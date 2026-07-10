/**
 * main.js — EMORA CLI Agent
 * UI redesign: Claude Code–style tool bullets, diff output, task tracker,
 * session chip, clean autocomplete.
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
import { closeMCPClients }            from "./tools/mcp_bridge.js";

// ═══════════════════════════════════════════════════════════════════════
// COLOR TOKENS
// ═══════════════════════════════════════════════════════════════════════
const dim    = chalk.hex("#6e7681");
const cyan   = chalk.hex("#58a6ff");
const green  = chalk.hex("#3fb950");
const yellow = chalk.hex("#d29922");
const muted  = chalk.hex("#8b949e");
const bold   = chalk.bold;
const red    = chalk.hex("#f85149");
const purple = chalk.hex("#a371f7");
const white  = chalk.hex("#e6edf3");
const bgRed  = chalk.bgHex("#3d1b1b");
const bgGreen= chalk.bgHex("#1b2d1b");

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

// ─── Chip / badge helper ─────────────────────────────────────────────
// Renders a small bracketed chip like: [redesign-ui]
function chip(text, color = dim) {
  return dim("[") + color(text) + dim("]");
}

// ─── Right-align a string on the same line ───────────────────────────
function rightAlign(left, right) {
  const lRaw = stripAnsi(left);
  const rRaw = stripAnsi(right);
  const gap = Math.max(1, W() - lRaw.length - rRaw.length);
  return left + " ".repeat(gap) + right;
}

// ═══════════════════════════════════════════════════════════════════════
// SESSION STATE
// ═══════════════════════════════════════════════════════════════════════
const sessionStart = Date.now();
const state        = { currentSession: crypto.randomUUID() };

let lastResponseMs = 0;
let totalChars     = 0;
let msgCount       = 0;

// Short session ID for the chip (first 8 chars)
const SESSION_CHIP = state.currentSession.slice(0, 8);

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
// TIME HELPERS
// ═══════════════════════════════════════════════════════════════════════
function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60)  return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
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

// ═══════════════════════════════════════════════════════════════════════
// STATUS BAR  (rendered above the prompt)
// ═══════════════════════════════════════════════════════════════════════
function renderStatusBar() {
  const prov    = getProviderMeta();
  const model   = `${prov.label.toLowerCase().replace(/\s+/g, "-")}:${process.env.MODEL_NAME || "—"}`;
  const ctxMax  = 400_000;
  const pct     = Math.min(100, Math.round((totalChars / ctxMax) * 100));
  const charsK  = totalChars > 999 ? `${(totalChars / 1000).toFixed(1)}K` : `${totalChars}`;
  const limitK  = `${Math.round(ctxMax / 1000)}K`;
  const uptime  = formatTime(Date.now() - sessionStart);
  const lastR   = lastResponseMs ? `⊙ ${formatTime(lastResponseMs)}` : "⊙ —";

  const left = [
    yellow(`$ ${model}`),
    dim(`${charsK}/${limitK}`),
    progressBar(pct) + " " + dim(`${pct}%`),
    dim(uptime),
    muted(lastR),
    dim(`✓ ${msgCount} msg`),
  ].join(dim(" │ "));

  const right = chip(SESSION_CHIP, cyan);
  const leftRaw = stripAnsi(left);
  const rightRaw = stripAnsi(right);
  const gap = Math.max(1, W() - leftRaw.length - rightRaw.length);

  if (leftRaw.length + rightRaw.length + 1 <= W()) {
    console.log(left + " ".repeat(gap) + right);
  } else {
    // Narrow terminal: just left parts
    console.log([yellow(`$ ${model}`), dim(uptime), muted(lastR)].join(dim(" │ ")));
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

  // Skills
  try {
    const skills = fs.readdirSync("./skill", { withFileTypes: true }).filter(d => d.isDirectory());
    if (skills.length) {
      console.log();
      write("  " + dim("skills    "));
      const names = skills.map(s => muted(s.name));
      let line = "", count = 0;
      for (const n of names) {
        const sep  = count > 0 ? dim("  ·  ") : "";
        const try1 = stripAnsi(line + stripAnsi(sep) + stripAnsi(n));
        if (try1.length > W() - 12) { console.log(line); write("  " + " ".repeat(10)); line = n; }
        else { line += sep + n; }
        count++;
      }
      if (line) console.log(line);
    }
  } catch {}

  // Library
  try {
    const libMod = await import("./library/index.js");
    const topics  = libMod.listTopics();
    const catalog = libMod.loadIndex();
    const tkeys   = Object.keys(topics);
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
// THINKING DISPLAY  — spinner + elapsed
// ═══════════════════════════════════════════════════════════════════════
const THINKING_PHRASES = [
  "memikirkan jawaban",
  "sedang analisa",
  "meramu respons",
  "menghubungkan titik-titik",
  "memproses konteks",
  "memformulasikan jawaban",
  "nyusun pemikiran",
  "menelaah permintaan",
];
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function startThinking() {
  const t0     = Date.now();
  let   frameI = 0;
  let   active = true;

  // Initial line
  write(
    dim("  ") + cyan(SPINNER_FRAMES[0]) + " " +
    muted(THINKING_PHRASES[0] + "...") + "  " + dim("0.0s") + "\n"
  );

  const tick = setInterval(() => {
    if (!active) return;
    frameI = (frameI + 1) % SPINNER_FRAMES.length;
    const elapsed   = ((Date.now() - t0) / 1000).toFixed(1);
    const phraseI   = Math.floor((Date.now() - t0) / 3000) % THINKING_PHRASES.length;
    write("\x1B[1A\x1B[2K");
    write(
      dim("  ") + cyan(SPINNER_FRAMES[frameI]) + " " +
      muted(THINKING_PHRASES[phraseI] + "...") + "  " + dim(elapsed + "s") + "\n"
    );
  }, 80);

  function logEvent(formatted) {
    write("\x1B[1A\x1B[2K");
    console.log(formatted);
    // Restore spinner line (minimal, no elapsed update needed here)
    write(
      dim("  ") + cyan(SPINNER_FRAMES[frameI]) + " " +
      muted(THINKING_PHRASES[0] + "...") + "\n"
    );
  }

  function stop() {
    active = false;
    clearInterval(tick);
    write("\x1B[1A\x1B[2K");
    return Date.now() - t0;
  }

  return { logEvent, stop };
}

// ═══════════════════════════════════════════════════════════════════════
// TOOL LABEL MAP  — maps internal tool names → display names
// Uses Claude Code style: capitalize first letter, verb form
// ═══════════════════════════════════════════════════════════════════════
const TOOL_LABELS = {
  shell_exec:      "Bash",
  read_file:       "Read",
  write_file:      "Write",
  list_files:      "List",
  search_web:      "WebSearch",
  fetch_page:      "Fetch",
  git_manager:     "Git",
  backup_manager:  "Backup",
  scheduler:       "Scheduler",
  project_manager: "TodoWrite",
  system_monitor:  "SysMon",
  group_manager:   "Group",
  skill_factory:   "SkillFactory",
  zip_compress:    "Zip",
  zip_extract:     "Unzip",
  create_folder:   "Mkdir",
  delete_folder:   "Rmdir",
  search_text:     "Grep",
  find_folder:     "Find",
  economy_manager: "Economy",
  emora_hub:       "Hub",
  datetime:        "DateTime",
};

// Extract a short arg preview for the tool invocation line
// Returns: "preview string" to show inside parens
function getArgPreview(name, args) {
  if (!args) return "";
  if (args.command)      return String(args.command).slice(0, 60);
  if (args.path)         return args.path;
  if (args.query)        return `"${String(args.query).slice(0, 48)}"`;
  if (args.action)       return args.action;
  if (args.url)          return String(args.url).slice(0, 55);
  if (args.filename)     return args.filename;
  if (args.topic)        return args.topic;
  return "";
}

// ═══════════════════════════════════════════════════════════════════════
// TOOL EVENT RENDERER  (Claude Code style)
//
//   ● Bash(node --check server.js && echo "server.js OK")
//   └  server.js OK
//
//   ● Read(src/index.js)
//   └  $ 342 lines
//
//   ◈ reading skill weather
// ═══════════════════════════════════════════════════════════════════════
function formatToolUse(name, args) {
  let label = TOOL_LABELS[name] || name;

  // MCP-bridged tools: "mcp_<server>__<tool>" -> "MCP:server/tool"
  const mcpMatch = name.match(/^mcp_(.+?)__(.+)$/);
  if (mcpMatch) label = `MCP:${mcpMatch[1]}/${mcpMatch[2]}`;

  const preview = getArgPreview(name, args);
  const head    = green("  ● ") + white.bold(label) + dim("(") + dim(preview) + dim(")");
  return head;
}

function formatToolResult(name, result, durationMs) {
  const preview  = result ? String(result).trim().split("\n")[0].slice(0, 68) : "";
  const dur      = durationMs != null ? dim(`  ${(durationMs / 1000).toFixed(1)}s`) : "";
  if (!preview) return null;
  return dim("  └  ") + muted(preview) + dur;
}

function formatSkillRead(skillName) {
  return purple("  ◈ ") + dim("reading skill ") + cyan.bold(skillName);
}

// ═══════════════════════════════════════════════════════════════════════
// PRINT AI RESPONSE  — Claude Code style
// ═══════════════════════════════════════════════════════════════════════
function printResponse(text, durationMs) {
  const agentName = process.env.NAME || "Emora";
  totalChars += text.length;
  msgCount++;
  lastResponseMs = durationMs;

  // ── Header line  ─  AgentName ────────────────────── [session]
  const nameStr    = green.bold(agentName);
  const headerLeft = "  " + dim("─") + " " + nameStr + " ";
  const sessionTag = chip(SESSION_CHIP, cyan);
  const dashLen    = Math.max(0, W() - stripAnsi(headerLeft).length - stripAnsi(sessionTag).length);
  console.log(headerLeft + dim("─".repeat(dashLen)) + " " + sessionTag);
  console.log();

  const maxW = W() - 4;

  for (const rawLine of text.split("\n")) {
    // Blank line
    if (!rawLine.trim()) { console.log(); continue; }

    // Detect markdown-ish patterns
    const isH1     = /^# /.test(rawLine);
    const isH2     = /^#{2,3} /.test(rawLine);
    const isBullet = /^\s*[-•*▸]\s/.test(rawLine);
    const isCode   = rawLine.startsWith("    ") || rawLine.startsWith("\t");
    // Diff-style lines (if AI outputs unified diff)
    const isDiffAdd = /^\+(?!\+\+)/.test(rawLine);
    const isDiffRem = /^-(?!--)/.test(rawLine);
    const isDiffNum = /^\d+\s+[+\-]/.test(rawLine);

    if (isCode) {
      // Inline code block: dim background-ish
      console.log("  " + dim(rawLine));
      continue;
    }

    if (isDiffAdd) {
      const lineStr = rawLine.replace(/\n$/, "");
      console.log("  " + bgGreen(green("  " + lineStr.padEnd(Math.min(lineStr.length + 2, maxW - 2)))));
      continue;
    }

    if (isDiffRem) {
      const lineStr = rawLine.replace(/\n$/, "");
      console.log("  " + bgRed(red("  " + lineStr.padEnd(Math.min(lineStr.length + 2, maxW - 2)))));
      continue;
    }

    // Word wrap
    const words   = rawLine.split(" ");
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
      if (isH1) {
        out = cyan.bold.underline(line.replace(/^# /, ""));
      } else if (isH2) {
        out = cyan.bold(line.replace(/^#{2,3} /, ""));
      } else {
        // Inline formatting
        out = out.replace(/`([^`]+)`/g,       (_, c) => cyan("`" + c + "`"));
        out = out.replace(/\*\*([^*]+)\*\*/g,  (_, c) => bold(white(c)));
        out = out.replace(/\*([^*]+)\*/g,      (_, c) => white(c));
        if (isBullet) {
          // Replace bullet marker with green ●
          out = out.replace(/^(\s*)[-•*▸]\s/, (_, sp) => sp + green("● ") );
        }
      }
      console.log("  " + out);
    }
  }

  console.log();

  // Footer: timing + word count
  if (durationMs) {
    const durStr   = (durationMs / 1000).toFixed(1) + "s";
    const charStr  = text.length > 999 ? `${(text.length / 1000).toFixed(1)}K chars` : `${text.length} chars`;
    console.log(dim(`  ✓ ${durStr}  ·  ${charStr}`));
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
  console.log("  " + purple.bold("SLASH COMMANDS"));
  console.log(SEP());
  SLASH_COMMANDS.forEach(({ cmd, desc }) => {
    console.log(
      "  " + cyan.bold(pad(cmd, 14)) +
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
 * Render status bar + prompt + optional autocomplete list.
 * Returns number of lines printed (for clearing on next key).
 */
function renderInputArea(buf, completions = null) {
  let lines = 0;

  // Status bar
  renderStatusBar();
  lines++;

  // Prompt line: "> " + typed text
  if (completions !== null) {
    // In slash mode: show dim border, then prompt
    write(SEP() + "\n"); lines++;
  }

  write(dim("> ") + (buf ? yellow(buf) : "") + "\n");
  lines++;

  // Autocomplete popup below prompt
  if (completions !== null && completions.length > 0) {
    for (const { cmd, desc, selected } of completions) {
      const cmdStr  = selected ? green.bold(pad(cmd, 16)) : white(pad(cmd, 16));
      const descStr = selected ? white(desc)              : dim(desc);
      write("  " + cmdStr + "  " + descStr + "\n");
      lines++;
    }
  }

  return lines;
}

function readInput() {
  return new Promise((resolve) => {
    let buf       = "";
    let slashMode = false;
    let selIdx    = -1;
    let renderedLines = 0;

    function filtered() {
      const q = buf.slice(1).toLowerCase();
      return SLASH_COMMANDS.filter(c =>
        !q || c.cmd.slice(1).startsWith(q) || c.desc.toLowerCase().includes(q)
      );
    }

    function buildCompletions(idx) {
      if (!slashMode) return null;
      return filtered().map((c, i) => ({ ...c, selected: i === idx }));
    }

    function render() {
      clearLines(renderedLines);
      const comps = buildCompletions(selIdx);
      renderedLines = renderInputArea(buf, comps);
    }

    render();

    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");

    function cleanup() {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.removeListener("data", onKey);
    }

    async function onKey(key) {
      if (key === "\x03") {
        cleanup(); clearLines(renderedLines); resolve(null); return;
      }
      if (key === "\x04") {
        cleanup(); clearLines(renderedLines);
        printSystem("Sampai jumpa! 👋", { isExit: true });
        process.exit(0);
      }
      if (key === "\r" || key === "\n") {
        if (slashMode && selIdx >= 0) {
          const chosen = filtered()[selIdx];
          if (chosen) {
            cleanup(); clearLines(renderedLines);
            const noArg = ["/new","/sesilist","/help","/exit","/clear","/sesi"];
            if (noArg.includes(chosen.cmd)) {
              resolve(chosen.cmd);
            } else {
              buf = chosen.cmd + " "; slashMode = false; selIdx = -1; renderedLines = 0; render();
            }
            return;
          }
        }
        cleanup(); clearLines(renderedLines); resolve(buf.trim()); return;
      }
      if (key === "\x7F" || key === "\b") {
        buf = buf.slice(0, -1); slashMode = buf.startsWith("/");
        if (!slashMode) selIdx = -1; render(); return;
      }
      if (key === "\x1B" && !key.startsWith("\x1B[")) {
        buf = ""; slashMode = false; selIdx = -1; render(); return;
      }
      if (key === "\x1B[A") {
        if (slashMode) {
          const f = filtered();
          selIdx = selIdx <= 0 ? f.length - 1 : selIdx - 1;
          render();
        }
        return;
      }
      if (key === "\x1B[B") {
        if (slashMode) {
          const f = filtered();
          selIdx = (selIdx + 1) % f.length;
          render();
        }
        return;
      }
      if (key === "\x1B[C" || key === "\x1B[D") return;
      if (key === "\t") {
        if (slashMode) {
          const f = filtered();
          if (f.length === 1) {
            buf = f[0].cmd + " "; slashMode = false; selIdx = -1;
          } else if (selIdx >= 0 && f[selIdx]) {
            buf = f[selIdx].cmd + " "; slashMode = false; selIdx = -1;
          }
          render();
        }
        return;
      }
      if (key.startsWith("\x1B")) return;

      buf += key;
      slashMode = buf.startsWith("/");
      if (!slashMode) selIdx = -1;
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
      console.log(rightAlign(
        yellow("  🔔 Background Task ") + dim(job_id),
        chip("bg", yellow)
      ));
      result.split("\n").forEach(l => console.log(dim("  │ ") + white(l)));
      console.log(dim("  └" + "─".repeat(W() - 4)));
      console.log();
    }
  } catch (err) {
    console.log(red(`\n  ✗ [BG ${job_id}] ${err.message}\n`));
  } finally {
    bgLocks[job_id] = false;
  }
});

// ═══════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════
async function runChat() {
  await showBanner();

  while (true) {
    const input = await readInput();
    if (input === null) continue;
    if (!input)         continue;

    // ── Slash commands ──────────────────────────────────────────────
    const cmdResult = await handleCommand(input, state);
    if (cmdResult) {
      if (cmdResult.action === "exit") {
        printSystem(cmdResult.message, { isExit: true }); process.exit(0);
      }
      if (cmdResult.action === "help")  { printHelp(); continue; }
      if (cmdResult.action === "reply") { printSystem(cmdResult.message); continue; }
      continue;
    }

    // ── AI turn ─────────────────────────────────────────────────────
    msgCount++;
    totalChars += input.length;

    console.log();
    console.log(SEP());

    const thinking      = startThinking();
    const toolCallStart = new Map();   // name -> startMs

    try {
      const result = await ask(llm, tools, state.currentSession, input, {
        onEvent(ev) {
          if (ev.type === "tool_use") {
            toolCallStart.set(ev.name, Date.now());
            thinking.logEvent(formatToolUse(ev.name, ev.args));

          } else if (ev.type === "tool_result") {
            const startMs = toolCallStart.get(ev.name);
            const dur     = startMs != null ? Date.now() - startMs : null;
            toolCallStart.delete(ev.name);
            const line = formatToolResult(ev.name, ev.result, dur);
            if (line) thinking.logEvent(line);

          } else if (ev.type === "skill_read") {
            thinking.logEvent(formatSkillRead(ev.name));
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

process.on("SIGINT",  () => { closeMCPClients(); process.exit(0); });
process.on("exit",    () => { closeMCPClients(); });
