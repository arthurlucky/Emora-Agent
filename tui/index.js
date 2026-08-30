/**
 * tui/index.js
 *
 * Entry point TUI baru (`emora`, tanpa subcommand). Ganti raw-loop lama di
 * main.js dengan aplikasi full-screen berbasis Ink.
 */
import React from "react";
import { render } from "ink";
import chalk from "chalk";

import tools from "../core/tools.js";
import { createLLM, getProviderMeta, detectProvider } from "../provider/index.js";
import { createSession } from "../core/sessionStore.js";
import App from "./App.js";
import { refreshSkillSuggestionCache } from "./cmd.js";
import { logLine } from "../utils/logger.js";

const red = chalk.hex("#f85149");
const cyan = chalk.hex("#58a6ff");
const dim = chalk.hex("#8b949e");

const ALT_SCREEN_ON = "\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l";
const ALT_SCREEN_OFF = "\x1b[?25h\x1b[?1049l";

function formatConsoleArg(a) {
  if (a instanceof Error) return a.stack || a.message || String(a);
  if (typeof a === "string") return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"];
const CONSOLE_LEVEL = { log: "info", info: "info", warn: "warn", error: "error", debug: "info" };

/**
 * BUGFIX (TUI kelap-kelip / sisa teks gak pernah hilang): redam console.*
 * yang nulis LANGSUNG ke terminal selama TUI aktif, dikembalikan lagi di
 * cleanup() sebelum ringkasan exit dicetak.
 *
 * core/chat.js, core/pluginHooks.js, core/tools.js, dll dipakai BARENG-BARENG
 * sama gateway Telegram/WhatsApp/Discord/dst yang jalan headless (di sana
 * console.error/warn justru berguna buat operator via journalctl/pm2 logs,
 * jadi file-file itu SENGAJA tidak diubah). Tapi beberapa di antaranya
 * kadang console.warn/error LANGSUNG buat hal non-fatal (retry, compaction,
 * plugin hook gagal, reload toolset gagal, dst). Kalau itu kejadian PAS Ink
 * lagi pegang layar penuh (alt-screen), tulisan itu nyelip di luar area
 * yang di-track Ink — nyumbang ke TUI "kelap-kelip"/lompat dan sisa teks
 * yang gak pernah ke-clear pas Ink render ulang.
 *
 * Solusinya BUKAN nyisir & ubah satu-satu semua console.* di seluruh
 * codebase (berisiko kebablasan ke file yang dipakai gateway), tapi nahan
 * di SATU titik ini: selama sesi TUI, semua console.* dialihkan ke file log
 * (.emora/logs/emora.log — sama yang dibaca `emora doctor`) alih-alih
 * tembus ke terminal. render() juga dipanggil dengan patchConsole:false
 * supaya gak dobel sama mekanisme patch bawaan Ink.
 */
function installConsoleGuard() {
  const original = {};
  for (const m of CONSOLE_METHODS) original[m] = console[m].bind(console);
  for (const m of CONSOLE_METHODS) {
    console[m] = (...args) => {
      try {
        logLine(CONSOLE_LEVEL[m], args.map(formatConsoleArg).join(" "));
      } catch { /* jangan sampai logging bikin crash */ }
    };
  }
  return () => {
    for (const m of CONSOLE_METHODS) console[m] = original[m];
  };
}

export async function runTUI(options = {}) {
  const { initialQuery = "", resumeSession = null } = options;

  if (!process.stdout.isTTY) {
    console.error(red("\n  ✗ TUI EMORA butuh terminal interaktif (TTY)."));
    console.error(dim("  Kalau lagi jalan lewat pipe/script, pakai 'emora send' atau 'emora gateway' sebagai gantinya.\n"));
    process.exitCode = 1;
    return;
  }

  let llm;
  try {
    llm = await createLLM(tools);
  } catch (err) {
    console.error(red(`\n  ✗ Gagal menyiapkan provider AI: ${err.message}`));
    console.error(dim(`  Jalankan ${cyan("emora setup")} buat konfigurasi provider dulu.\n`));
    process.exitCode = 1;
    return;
  }

  const meta = getProviderMeta(detectProvider());
  const modelName = process.env.MODEL_NAME || "default";

  // Mode operasi dari .emora/mode.json (disimpan via /mode atau emora config)
  // — dulu TUI selalu mulai di autonomous walau user terakhir set plan/safe.
  let startMode = "autonomous";
  try {
    const { getMode } = await import("../tools/change_mode.js");
    startMode = await getMode();
  } catch {}

  let session;
  if (resumeSession) {
    const { getSession } = await import("../core/sessionStore.js");
    session = await getSession(resumeSession);
    if (!session) {
      console.error(red(`\n  ✗ Session tidak ditemukan: ${resumeSession}\n`));
      process.exitCode = 1;
      return;
    }
  } else {
    session = await createSession("Sesi baru");
  }

  // Fire-and-forget: isi cache autocomplete skill/plugin di background,
  // gak perlu nge-block startup TUI nunggu scan disk selesai.
  refreshSkillSuggestionCache();

  const startTime = Date.now();
  process.stdout.write(ALT_SCREEN_ON);
  const restoreConsole = installConsoleGuard();

  let exited = false;
  let messagesExisted = false;
  // Track apakah ada percakapan — di-set oleh App via onActivity callback.
  const markConversation = () => { messagesExisted = true; };
  const cleanup = () => {
    if (exited) return;
    exited = true;
    restoreConsole();
    process.stdout.write(ALT_SCREEN_OFF);
    // Aturan TUI.md #11: clear terminal + ringkasan sesi saat keluar.
    try {
      process.stdout.write("\x1b[2J\x1b[H");
      // Ada percakapan → tampilkan resume hint + summary. Kosong → goodbye saja.
      const hasConversation = (session.messageCount || 0) > 0 || messagesExisted;
      if (!hasConversation) {
        console.log("");
        console.log(chalk.yellow("  Goodbye! 👋"));
        console.log(chalk.dim("  Sampai jumpa di sesi berikutnya."));
        console.log("");
        return;
      }
      const dur = Math.round((Date.now() - (startTime || Date.now())) / 1000);
      const sid = session.id;
      const title = session.name || session.title || "Sesi baru";
      const msgCount = session.messageCount ?? "?";
      console.log("");
      console.log(chalk.yellow("  Resume this session with:"));
      console.log(`    ${cyan(`emora --resume ${sid}`)}`);
      console.log(`    ${cyan(`emora -c "${title.replace(/"/g, "").slice(0, 60)}"`)}`);
      console.log("");
      console.log(`  ${dim("Session:")}        ${sid}`);
      console.log(`  ${dim("Title:")}          ${title.slice(0, 70)}`);
      console.log(`  ${dim("Duration:")}       ${dur}s`);
      console.log(`  ${dim("Messages:")}       ${msgCount}`);
      console.log("");
    } catch {}
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });

  const app = render(
    React.createElement(App, {
      sessionId: session.id,
      sessionTitle: session.name || session.title || "Sesi baru",
      provider: { name: meta.label, model: modelName },
      initialMode: startMode,
      llm,
      tools,
      initialQuery,
      onQuit: cleanup,
      onActivity: markConversation,
    }),
    { exitOnCtrlC: false, patchConsole: false }
  );

  await app.waitUntilExit();
  cleanup();
  // BUGFIX (stuck, gak bisa keluar): jaring pengaman kalau ada handle yang
  // nyangkut (request LLM yang belum bener-bener ke-abort di level socket,
  // timer nyasar, dst) sehingga event loop gak kosong walau user udah minta
  // keluar (Ctrl+C 2x / "/exit") — paksa proses berhenti setelah jeda
  // singkat, drpd EMORA "kelihatan keluar" tapi prosesnya zombie di
  // belakang layar. unref() supaya timer ini SENDIRI gak nahan proses tetap
  // hidup kalau semuanya udah bersih (exit alami akan lebih cepat dari ini).
  setTimeout(() => process.exit(0), 1500).unref();
}
