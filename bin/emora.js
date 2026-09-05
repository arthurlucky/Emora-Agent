#!/usr/bin/env node
/**
 * bin/emora.js
 *
 * Entrypoint utama binary `emora`. Semua subcommand di-route dari sini.
 *
 * emora            → start TUI agent (tui/index.js)
 * emora setup      → interactive setup wizard
 * emora model      → ganti model/provider
 * emora gateway    → kontrol gateway Telegram/WhatsApp/Discord (status/start/stop/run/setup/cron/service)
 * emora send       → kirim pesan one-shot ke Telegram/WhatsApp/Discord
 * emora status     → status dashboard
 * emora skills     → skill manager
 * emora plugin     → kelola tool built-in & plugin eksternal (live disable/enable/reload)
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

const originalCWD = process.cwd();

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

// Inisialisasi konfigurasi sedini mungkin (SETELAH chdir)
await import("../core/config.js");

// ── Version ──────────────────────────────────────────────────────────────────
const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"));
const VERSION = pkg.version || "1.0.0";

// ── Global Error Handlers (Mencegah Crash di Termux) ────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('[ UNHANDLED REJECTION ]'), reason);
});
process.on('uncaughtException', (err) => {
  console.error(chalk.red('[ UNCAUGHT EXCEPTION ]'), err);
});

// ── Color helpers ─────────────────────────────────────────────────────────────
const dim    = chalk.hex("#6e7681");
const cyan   = chalk.hex("#58a6ff");
const green  = chalk.hex("#3fb950");
const yellow = chalk.hex("#d29922");
const muted  = chalk.hex("#8b949e");
const red    = chalk.hex("#f85149");
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

  const groups = [
    ["SESSION", [
      ["emora",                 "TUI interaktif (default)"],
      ["emora repl",            "REPL ringan (prompt > )"],
      ["emora -r <uuid>",       "Resume sesi tertentu"],
      ["emora -s list|delete|title", "Kelola sesi: delete <id|all>, regen judul"],
      ["emora run \"<prompt>\"", "Chat sekali jalan, keluar setelah jawab"],
    ]],
    ["CONFIG", [
      ["emora setup",           "Setup wizard penuh"],
      ["emora model ...",       "Ganti model/provider/profile (set, save, use)"],
      ["emora config ...",      "Baca/tulis .env langsung (list, get, set)"],
    ]],
    ["CAPABILITIES", [
      ["emora skills",          "Browse & kelola skill"],
      ["emora toolset ...",     "Preset grup tool aktif (list, use, on, off)"],
      ["emora plugin ...",      "Kelola plugin (install, enable, disable)"],
      ["emora mcp ...",         "MCP server manager"],
      ["emora obsidian ...",    "Integrasi vault Obsidian"],
      ["emora backends ...",    "Backend SSH untuk shell_exec (list, add, rm)"],
      ["emora kl ...",          "Integrasi knowledge library"],
    ]],
    ["KNOWLEDGE LIBRARY (kl)", [
      ["emora kl vault",              "Atur lokasi penyimpanan (default/obsidian/custom)"],
      ["emora kl install <url>",      "Tambah knowledge dari URL"],
      ["emora kl list",               "Daftar topik & subtopik"],
      ["emora kl search <query>",     "Cari knowledge"],
      ["emora kl info <relPath>",     "Lihat metadata & backlink file"],
    ]],
    ["COMMUNITY & PUBLISH", [
      ["emora install:skill <name>", "Install skill dari komunitas"],
      ["emora install:tool <name>",  "Install tool dari komunitas"],
      ["emora publish:skill",        "Publish skill (--namaskill, --desc, --tags)"],
      ["emora publish:tool",         "Publish tool (--namatool, --desc, --tags)"],
      ["emora community --setkey=K", "Set API key untuk fitur komunitas"],
    ]],
    ["OPS & STATUS", [
      ["emora gateway ...",     "Jalankan gateway messaging (Telegram, WA, dll)"],
      ["emora bot ...",         "Kelola fitur bot"],
      ["emora send \"<msg>\"",  "Kirim pesan one-shot ke webhook/platform"],
      ["emora swarm ...",       "Container subagent persistent"],
      ["emora status",          "Status semua komponen sistem"],
      ["emora records",         "Tampilkan metrics atau log records"],
      ["emora --web",           "Jalankan CLI + dashboard browser (WebUI)"],
      ["emora doctor",          "Mendiagnosa dan memulihkan masalah sistem"],
      ["emora migrate",         "Migrasi konfigurasi lawas (deprecated)"],
    ]],
  ];

  for (const [title, cmds] of groups) {
    console.log(cyan("  │  ") + chalk.hex("#a371f7").bold(title));
    for (const [cmd, desc] of cmds) {
      console.log(cyan("  │    ") + green.bold(cmd.padEnd(36)) + muted(desc));
    }
    console.log(cyan("  │"));
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
const { authenticate } = await import("../core/security.js");
await authenticate();
const noTrustCommands = ["setup", "model", "plugin", "gateway", "update", "tokens", "help", "version", "-s", "--sessions", "obsidian", "doctor"];

if (!noTrustCommands.includes(subCmd) && originalCWD !== PKG_ROOT) {
  const fsSync = await import("fs");
  const path = await import("path");
  const os = await import("os");
  const trustFile = path.join(os.homedir(), ".emora_trusted_workspaces");
  
  let trustedPaths = [];
  try {
    if (fsSync.existsSync(trustFile)) {
      trustedPaths = fsSync.readFileSync(trustFile, "utf8").split("\n").filter(Boolean);
    }
  } catch(e) {}

  if (trustedPaths.includes(originalCWD)) {
    process.env.EMORA_BOUNDED_WORKSPACE = originalCWD;
  } else {
    const { select } = await import("../cli/select.js");
    console.log(chalk.cyan(`
          ▄████▄        
         ███  ███       
         ████████       
         ██ ▀▀ ██       
          ▀▄  ▄▀        
    `));
    const trust = await select(`Trust this folder? (${originalCWD})`, [
      { label: "Trust this folder", value: true },
      { label: "no", value: false }
    ]);
    if (trust) {
      process.env.EMORA_BOUNDED_WORKSPACE = originalCWD;
      try {
        fsSync.appendFileSync(trustFile, originalCWD + "\n");
      } catch(e) {}
    } else {
      console.log(chalk.yellow("  Operation cancelled. Emora requires trust to run in this folder."));
      process.exit(0);
    }
  }
}

switch (subCmd) {
  case "--web":
  case "webui": {
  const { startWebUI } = await import("../webui/server.js");
  await startWebUI();
  break;
}
  
  case undefined:
  case "tui":
  case "repl":
  case "--debug": {
    // Trust logic moved globally
    // `emora repl` = REPL ringan; default tetap TUI penuh.
    if (subCmd === "repl" || process.env.EMORA_REPL === "1") {
      const { runREPL } = await import("../cli/repl.js");
      await runREPL();
      break;
    }
    const { runTUI } = await import("../tui/index.js");
    await runTUI();
    break;
  }

  case "-s":
  case "--sessions": {
    // emora -s list | delete <id|all> | title <id>
    const { listSessions, deleteSession, getSession, touchSession } = await import("../core/sessionStore.js");
    const action = rest[0];
    if (action === "list") {
      const all = await listSessions();
      if (!all.length) { console.log(muted("  Belum ada sesi.")); break; }
      for (const s of all) console.log(`  ${cyan.bold(s.id.slice(0, 8))}  ${muted(s.name || s.title || "(tanpa judul)")}`);
      break;
    }
    if (action === "delete") {
      const target = rest[1];
      if (target === "all") {
        const all = await listSessions();
        for (const s of all) await deleteSession(s.id);
        console.log(green(`  ✓ ${all.length} sesi dihapus.`));
        break;
      }
      if (!target) { console.error(red("  ✗ Gunakan: emora -s delete <id|all>")); process.exit(1); }
      // Resolve partial ID (prefix) ke UUID penuh.
      let id = target;
      const all = await listSessions();
      const hit = all.find(s => s.id === target) || all.find(s => s.id.startsWith(target));
      if (hit) id = hit.id;
      try {
        await deleteSession(id);
        console.log(green(`  ✓ Sesi ${id.slice(0, 8)} dihapus.`));
      } catch {
        // File non-UUID (mis. test) — hapus langsung.
        const fsSync = (await import("fs")).default;
        fsSync.rmSync(`memory/${id}.json`, { force: true });
        console.log(green(`  ✓ Sesi ${id.slice(0, 8)} dihapus.`));
      }
      break;
    }
    if (action === "title") {
      // Generate ulang judul sesi dari prompt pertamanya (tanpa LLM, dari isi sesi).
      const id = rest[1];
      if (!id) { console.error(red("  ✗ Gunakan: emora -s title <id>")); process.exit(1); }
      const { loadSession } = await import("../core/memory.js");
      const { generateTitleFromPrompt } = await import("../core/sessionStore.js");
      const msgs = await loadSession(id);
      const firstUser = msgs.find(m => m.role === "user");
      if (!firstUser) { console.error(red("  ✗ Sesi kosong.")); process.exit(1); }
      const title = generateTitleFromPrompt(firstUser.content) || "(tanpa judul)";
      await touchSession(id, firstUser.content);
      console.log(green(`  ✓ Judul sesi ${id.slice(0, 8)}: "${title}"`));
      break;
    }
    console.log(muted("  Gunakan: emora -s list | delete <id|all> | title <id>"));
    break;
  }

  case "-r":
  case "--resume": {
    const target = rest.join(" ").trim();
    if (!target) {
      console.error(red("  ✗ Gunakan: emora -r <id | prefix-id | judul sesi>"));
      process.exit(1);
    }
    // Resolve: UUID penuh → prefix ID → judul (case-insensitive contains).
    let resolved = target;
    const { listSessions } = await import("../core/sessionStore.js");
    const all = await listSessions();
    if (!all.some((s) => s.id === target)) {
      const hit =
        all.find((s) => s.id.startsWith(target)) ||
        all.find((s) => (s.name || "").toLowerCase().includes(target.toLowerCase()));
      if (!hit) {
        console.error(red(`  ✗ Sesi tidak ditemukan: "${target}"`));
        console.error(muted("  Lihat daftar: emora -s list"));
        process.exit(1);
      }
      resolved = hit.id;
      console.log(green(`  → Sesi ditemukan: ${hit.id.slice(0, 8)}  "${hit.name || "(tanpa judul)"}"`));
    }
    const { runTUI } = await import("../tui/index.js");
    await runTUI({ resumeSession: resolved });
    break;
  }

  case "setup": {
    const { runSetup } = await import("../setup.js");
    await runSetup();
    process.exit(0);
    break;
  }

  case "model": {
    const { cmdModel } = await import("../cli/cmd-model.js");
    await cmdModel(rest);
    break;
  }

  case "bot": {
    const { cmdBot } = await import("../cli/cmd-bot.js");
    await cmdBot(rest);
    break;
  }

  case "records": {
    const { cmdRecords } = await import("../cli/cmd-records.js");
    await cmdRecords(rest);
    break;
  }

  // ── Shortcut: non-interaktif, satu baris ────────────────
  case "run": {
    // emora run "prompt" — one-shot chat tanpa TUI.
    const prompt = rest.join(" ").trim();
    if (!prompt) {
      console.error(red("  ✗ Prompt wajib. Contoh: emora run \"jelaskan struktur folder ini\""));
      process.exit(1);
    }
    const [{ createLLM }, toolsMod, { ask }, { detectProvider }] = await Promise.all([
      import("../provider/index.js"),
      import("../core/tools.js"),
      import("../core/chat.js"),
      import("../provider/index.js"),
    ]);
    const { default: tools } = toolsMod;
    const llm = await createLLM(tools);
    const sessionId = `cli-${Date.now()}`;
    const answer = await ask(llm, tools, sessionId, prompt);
    console.log(answer);
    break;
  }

  case "config": {
    // emora config get <KEY> | set <KEY> <VALUE> | list (menggunakan config.yml)
    const { getConfig, setConfig, loadAllConfig } = await import("../core/config.js");
    const action = rest[0];
    if (action === "list") {
      const cfg = loadAllConfig();
      console.log(cyan.bold("  ╭─ KONFIGURASI EMORA (config.yml) ──────────────────────────────"));
      for (const [k, v] of Object.entries(cfg)) {
        const valStr = String(v);
        const isSecret = /KEY|TOKEN|SECRET|PASSWORD/i.test(k);
        console.log(`  │  ${cyan.bold(k.padEnd(24))} ${isSecret ? dim("***" + valStr.slice(-4)) : muted(valStr)}`);
      }
      console.log(cyan.bold("  ╰───────────────────────────────────────────────────────────────"));
      break;
    }
    if (action === "get") {
      const key = rest[1];
      if (!key) { console.error(red("  ✗ Gunakan: emora config get <KEY>")); process.exit(1); }
      const val = getConfig(key);
      console.log(val ? val : dim("(tidak diset)"));
      break;
    }
    if (action === "set") {
      const key = rest[1], value = rest.slice(2).join(" ");
      if (!key || !value) { console.error(red("  ✗ Gunakan: emora config set <KEY> <VALUE>")); process.exit(1); }
      setConfig(key, value);
      console.log(green(`  ✓ [config.yml] ${key}=${/KEY|TOKEN|SECRET/i.test(key) ? "***" + value.slice(-4) : value}`));
      break;
    }
    console.error(muted("  Gunakan: emora config list | get <KEY> | set <KEY> <VALUE>"));
    break;
  }

  case "toolset": {
    // emora toolset list|use <preset>|on <group>|off <group>
    const { TOOL_GROUPS, PRESETS, getActiveGroups, applyPreset, setGroups, statusSummary } =
      await import("../utils/toolsets.js");
    const action = rest[0];
    if (!action || action === "list") {
      console.log(await statusSummary());
      break;
    }
    if (action === "use") {
      try {
        const g = await applyPreset(rest[1]);
        console.log(green(`  ✓ Preset "${rest[1]}" aktif (${g.length} grup). Restart TUI/gateway agar berlaku.`));
      } catch (e) { console.error(red(`  ✗ ${e.message}`)); }
      break;
    }
    if (action === "on" || action === "off") {
      const group = rest[1];
      if (!TOOL_GROUPS[group]) { console.error(red(`  ✗ Grup tidak dikenal. Pilihan: ${Object.keys(TOOL_GROUPS).join(", ")}`)); process.exit(1); }
      const cur = await getActiveGroups();
      const next = action === "on" ? [...new Set([...cur, group])] : cur.filter((g) => g !== group);
      await setGroups(next);
      console.log(green(`  ✓ Grup ${group} ${action === "on" ? "diaktifkan" : "dinonaktifkan"}. Restart agar berlaku.`));
      break;
    }
    console.log(muted("  Gunakan: emora toolset list | use <preset> | on <group> | off <group>"));
    break;
  }

  case "backends": {
    // emora backends list|add <name> <host> <user> [port]
    const fsSync = (await import("fs")).default;
    const file = ".emora/backends.json";
    let bks = {};
    try { bks = JSON.parse(fsSync.readFileSync(file, "utf8")); } catch {}
    const action = rest[0];
    if (!action || action === "list") {
      const entries = Object.entries(bks);
      if (!entries.length) { console.log(muted("  Belum ada backend SSH. Tambah: emora backends add <name> <host> <user> [port]")); break; }
      for (const [name, b] of entries) console.log(`  ${cyan.bold(name.padEnd(14))} ${muted(`${b.user}@${b.host}:${b.port || 22}`)}`);
      break;
    }
    if (action === "add") {
      const [, name, host, user, port] = rest;
      if (!name || !host || !user) { console.error(red("  ✗ Gunakan: emora backends add <name> <host> <user> [port]")); process.exit(1); }
      bks[name] = { host, user, port: Number(port) || 22 };
      fsSync.mkdirSync(".emora", { recursive: true });
      fsSync.writeFileSync(file, JSON.stringify(bks, null, 2));
      console.log(green(`  ✓ Backend "${name}" tersimpan → ${user}@${host}:${bks[name].port}`));
      break;
    }
    if (action === "remove") {
      delete bks[rest[1]];
      fsSync.mkdirSync(".emora", { recursive: true });
      fsSync.writeFileSync(file, JSON.stringify(bks, null, 2));
      console.log(green(`  ✓ Backend "${rest[1]}" dihapus.`));
      break;
    }
    console.log(muted("  Gunakan: emora backends list | add | remove"));
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

  case "swarm":
  case "container": {
    const { cmdSwarm } = await import("../cli/cmd-swarm.js");
    await cmdSwarm(rest);
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

  case "obsidian": {
    const { cmdObsidian } = await import("../cli/cmd-obsidian.js");
    await cmdObsidian(rest);
    break;
  }

  case "kl": {
    const { cmdKl } = await import("../cli/cmd-kl.js");
    await cmdKl(rest);
    break;
  }

  case "doctor": {
    const { runDoctor } = await import("../cli/cmd-doctor.js");
    await runDoctor();
    break;
  }

  case "migrate": {
    // Memory tetap JSON-enhanced (better-sqlite3 tidak bisa build di Termux).
    // memoryDB.js sudah di-deprecate — command ini hanya menampilkan status.
    console.log("✅ EMORA sudah menggunakan JSON-based memory (core/memory.js).");
    console.log("   Tidak perlu migrasi. memoryDB.js sudah di-deprecate.");
    break;
  }

  case "plugin":
  case "plugins": {
    const { cmdPlugin } = await import("../cli/cmd-plugin.js");
    await cmdPlugin(rest);
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
