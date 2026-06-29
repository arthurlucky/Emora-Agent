#!/usr/bin/env node
/**
 * bin/emora.js
 *
 * Entrypoint utama binary `emora`. Semua subcommand di-route dari sini.
 *
 * emora            → start CLI agent (main.js)
 * emora setup      → interactive setup wizard
 * emora model      → ganti model/provider
 * emora gateway    → start gateway only (no CLI loop)
 * emora send       → kirim pesan one-shot ke Telegram/WhatsApp
 * emora status     → status dashboard
 * emora skills     → skill manager
 * emora mcp        → MCP server manager
 * emora --version  → tampilkan versi
 * emora --web      → start CLI + Web UI
 * emora --help     → tampilkan help
 */

import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import chalk from "chalk";

// ── Pastikan CWD adalah root project EMORA ──────────────────────────────────
// Kalau `emora` diinstall global (npm install -g), __dirname akan menunjuk
// ke lokasi package yang di-install, bukan tempat user menjalankan command.
// Kita selalu set CWD ke direktori package itu sendiri supaya semua path
// relatif (./skill, ./memory, ./gateway, ./.env) konsisten.
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PKG_ROOT   = path.resolve(__dirname, "..");

// Pindah ke root project supaya semua import relatif berjalan benar
process.chdir(PKG_ROOT);

// ── Version ──────────────────────────────────────────────────────────────────
const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"));
const VERSION = pkg.version || "1.0.0";

// ── Color helpers ─────────────────────────────────────────────────────────────
// ── Color helpers ─────────────────────────────────────────────────────────────
const dim    = chalk.hex("#6e7681");
const cyan   = chalk.hex("#58a6ff");
const green  = chalk.hex("#3fb950");
const yellow = chalk.hex("#d29922");
const muted  = chalk.hex("#8b949e");
const bold   = chalk.bold;


// ── Arg value parser ──────────────────────────────────────────────────────
function getArgValue(args, flag) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith(flag + "=")) return arg.split("=")[1];
    if (arg === flag && i + 1 < args.length) return args[i + 1];
  }
  return null;
}
// ── Help text ─────────────────────────────────────────────────────────────────
function printHelp() {
  const w = Math.min(process.stdout.columns || 80, 88);
  console.log();
  console.log(cyan.bold("  ╭─ EMORA CLI ") + dim("─".repeat(w - 15)));
  console.log(cyan("  │  ") + muted(`Version ${VERSION}  ·  Autonomous AI Agent`));
  console.log(cyan("  │"));
  console.log(cyan("  │  ") + chalk.hex("#a371f7").bold("USAGE"));
  console.log(cyan("  │  ") + dim("─".repeat(60)));

  const cmds = [
    ["emora",           "Jalankan CLI agent (default)"],
    ["emora setup",     "Interactive setup wizard (provider, gateway, dll)"],
    ["emora model",     "Ganti model / provider AI"],
    ["emora gateway",   "Jalankan gateway Telegram/WhatsApp saja (tanpa CLI)"],
    ["emora send",      "Kirim pesan one-shot ke Telegram/WhatsApp"],
    ["emora status",    "Tampilkan status semua komponen EMORA"],
    ["emora skills",    "Browse & kelola skill"],
    ["emora mcp",       "Manage MCP server & jalankan EMORA sebagai MCP server"],
  ["emora install:skill <@user/nama>", "Install skill dari EMORA Hub (bisa pake @user/nama atau nama saja)"],
["emora install:tool <@user/nama>", "Install tool dari EMORA Hub (bisa pake @user/nama atau nama saja)"],
["emora publish:skill --namaskill=<nama> [--desc=<desc>] [--tags=<t1,t2>]", "Publikasikan skill ke EMORA Hub"],
["emora publish:tool --namatool=<nama> [--desc=<desc>] [--tags=<t1,t2>]", "Publikasikan tool ke EMORA Hub"],
["emora community --setkey=<apikey>", "Simpan API key EMORA Hub ke .env"],
    ["emora --web",     "Jalankan CLI + Web UI control panel"],
    ["emora --version", "Tampilkan versi"],
    ["emora --help",    "Tampilkan bantuan ini"],
  ];

  for (const [cmd, desc] of cmds) {
    console.log(cyan("  │  ") + green.bold(cmd.padEnd(24)) + muted(desc));
  }

  console.log(cyan("  │"));
  console.log(cyan("  │  ") + chalk.hex("#a371f7").bold("SEND EXAMPLES"));
  console.log(cyan("  │  ") + dim("─".repeat(60)));
  const examples = [
    ['emora send "Deploy berhasil ✅"',                       "Kirim ke platform aktif"],
    ['emora send --to=telegram "Hei dari cron job"',         "Kirim ke Telegram"],
    ['emora send --to=whatsapp --number=6281x "Hello"',      "Kirim ke nomor WA tertentu"],
    ['echo "$(df -h)" | emora send --to=telegram',           "Pipe stdout ke Telegram"],
  ];
  for (const [ex, desc] of examples) {
    console.log(cyan("  │  ") + dim("$ ") + cyan(ex));
    console.log(cyan("  │    ") + muted(desc));
  }

  console.log(cyan.bold("  ╰" + "─".repeat(w - 3)));
  console.log();
}

// ── Routing ───────────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const subCmd = args[0];
const rest   = args.slice(1);

// Flag checks
if (args.includes("--version") || args.includes("-v") || args.includes("--v")) {
  console.log(cyan(`EMORA v${VERSION}`));
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

// Sub-command router
switch (subCmd) {
  case "--web":
  case "webui": {
  const { startWebUI } = await import("../webui/server.js");
  await startWebUI();
  break;
}
  
  case undefined:
  case "--debug": {
    // Normal start: import dan run main.js
    await import("../main.js");
    break;
  }

  case "setup": {
    await import("../setup.js");
    break;
  }

  case "model": {
    const { cmdModel } = await import("../cli/cmd-model.js");
    await cmdModel(rest);
    break;
  }

  case "gateway": {
    const { cmdGateway } = await import("../cli/cmd-gateway.js");
    await cmdGateway(rest);
    break;
  }

  case "send": {
    const { cmdSend } = await import("../cli/cmd-send.js");
    await cmdSend(rest);
    break;
  }

  case "status": {
    const { cmdStatus } = await import("../cli/cmd-status.js");
    await cmdStatus(rest);
    break;
  }

  case "skills":
  case "skill": {
    const { cmdSkills } = await import("../cli/cmd-skills.js");
    await cmdSkills(rest);
    break;
  }

  case "mcp": {
    const { cmdMcp } = await import("../cli/cmd-mcp.js");
    await cmdMcp(rest);
    break;
  }
  
  
  
 case "install:skill": {
  const { installSkill } = await import("../cli/cmd-community.js");
  const name = rest[0];
  if (!name) {
    console.error(chalk.hex("#f85149")("  ✗ Nama skill harus diberikan. Contoh: @user/nama atau nama"));
    process.exit(1);
  }
  await installSkill(name);
  break;
}

case "install:tool": {
  const { installTool } = await import("../cli/cmd-community.js");
  const name = rest[0];
  if (!name) {
    console.error(chalk.hex("#f85149")("  ✗ Nama tool harus diberikan. Contoh: @user/nama atau nama"));
    process.exit(1);
  }
  await installTool(name);
  break;
}
case "publish:skill": {
  const { publishSkill } = await import("../cli/cmd-community.js");
  const name = getArgValue(rest, "--namaskill");
  const desc = getArgValue(rest, "--desc") || "";
  const tags = getArgValue(rest, "--tags") || "";
  if (!name) {
    console.error(chalk.hex("#f85149")("  ✗ Nama skill harus diberikan. Gunakan --namaskill=<nama>"));
    process.exit(1);
  }
  await publishSkill(name, desc, tags);
  break;
}

case "publish:tool": {
  const { publishTool } = await import("../cli/cmd-community.js");
  const name = getArgValue(rest, "--namatool");
  const desc = getArgValue(rest, "--desc") || "";
  const tags = getArgValue(rest, "--tags") || "";
  if (!name) {
    console.error(chalk.hex("#f85149")("  ✗ Nama tool harus diberikan. Gunakan --namatool=<nama>"));
    process.exit(1);
  }
  await publishTool(name, desc, tags);
  break;
}

case "community": {
  const { setApiKey } = await import("../cli/cmd-community.js");
  const key = getArgValue(rest, "--setkey");
  if (!key) {
    console.error(chalk.hex("#f85149")("  ✗ API key harus diberikan. Gunakan --setkey=<apikey>"));
    process.exit(1);
  }
  setApiKey(key);
  break;
}

  default: {
    console.error(chalk.hex("#f85149")(`  ✗ Subcommand tidak dikenal: "${subCmd}"`));
    console.error(muted(`  Jalankan ${cyan("emora --help")} untuk melihat semua perintah yang tersedia.`));
    process.exit(1);
  }
}
