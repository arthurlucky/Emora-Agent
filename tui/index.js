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
import { refreshSkillSuggestionCache } from "./slashCommands.js";

const red = chalk.hex("#f85149");
const cyan = chalk.hex("#58a6ff");
const dim = chalk.hex("#8b949e");

const ALT_SCREEN_ON = "\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l";
const ALT_SCREEN_OFF = "\x1b[?25h\x1b[?1049l";

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

  process.stdout.write(ALT_SCREEN_ON);

  let exited = false;
  const cleanup = () => {
    if (exited) return;
    exited = true;
    process.stdout.write(ALT_SCREEN_OFF);
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
    }),
    { exitOnCtrlC: false }
  );

  await app.waitUntilExit();
  cleanup();
}
