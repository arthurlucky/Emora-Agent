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
  case undefined:
  case "--web":
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

  default: {
    console.error(chalk.hex("#f85149")(`  ✗ Subcommand tidak dikenal: "${subCmd}"`));
    console.error(muted(`  Jalankan ${cyan("emora --help")} untuk melihat semua perintah yang tersedia.`));
    process.exit(1);
  }
}
