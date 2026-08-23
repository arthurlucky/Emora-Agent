/**
 * cli/repl.js — REPL interaktif ala Hermes Agent.
 *
 * Prompt "> ", input multi-baris (backslash \ untuk lanjut), slash command
 * inline (/help, /new, /mode, /sessions, /exit), riwayat via panah atas
 * (readline bawaan). Lebih ringan dari TUI penuh.
 *
 * ponytail: jawaban tidak di-stream (tunggu selesai). Upgrade: streaming
 * via llm.stream() kalau latency terasa berat.
 */
import readline from "readline";
import crypto from "crypto";
import chalk from "chalk";
import { createLLM } from "../provider/index.js";
import tools from "../core/tools.js";
import { ask } from "../core/chat.js";
import { listSessions } from "../core/memoryDB.js";

const dim = chalk.hex("#8b949e");
const cyan = chalk.hex("#58a6ff");
const green = chalk.hex("#3fb950");
const red = chalk.hex("#f85149");
const bold = chalk.bold;

export async function runREPL({ resumeSession = null } = {}) {
  let sessionId = resumeSession || crypto.randomUUID();

  const llm = createLLM({ tools });
  let mode = "autonomous";

  console.log();
  console.log(green.bold(" EMORA") + dim(` · ${process.env.MODEL_PROVIDER || "?"}/${process.env.MODEL_NAME || "?"} · sesi ${sessionId.slice(0, 8)}`));
  console.log(dim(" /help perintah · \\ di akhir baris = lanjut · Ctrl+D keluar"));
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: bold(cyan("> ")),
    historySize: 200,
  });

  let pending = ""; // multi-line: backslash di akhir baris = lanjut

  async function handleLine(line) {
    if (line.endsWith("\\")) {
      pending += line.slice(0, -1) + "\n";
      rl.setPrompt(bold(cyan("… ")));
      return;
    }
    const input = (pending + line).trim();
    pending = "";
    rl.setPrompt(bold(cyan("> ")));

    if (!input) return;

    if (input === "/exit" || input === "/quit") { rl.close(); return; }

    if (input === "/help") {
      console.log(dim(`
  /help            daftar perintah
  /new             sesi baru
  /mode <m>        autonomous | safe | plan
  /sessions        lihat sesi tersimpan
  /exit            keluar`));
      return;
    }

    if (input === "/new") {
      sessionId = crypto.randomUUID();
      console.log(dim(`  → sesi baru: ${sessionId.slice(0, 8)}`));
      return;
    }

    if (input.startsWith("/mode")) {
      const m = input.split(" ")[1];
      if (!["autonomous", "safe", "plan"].includes(m)) { console.log(dim("  mode: autonomous | safe | plan")); return; }
      try {
        const { setMode } = await import("../tools/change_mode.js");
        await setMode(m);
        mode = m;
        console.log(green(`  ✓ mode: ${m}`));
      } catch (e) { console.log(red(`  ✗ ${e.message}`)); }
      return;
    }

    if (input === "/sessions") {
      const all = await listSessions();
      if (!all.length) { console.log(dim("  (kosong)")); return; }
      for (const s of all.slice(0, 10)) console.log(dim(`  ${s.id.slice(0, 8)}  ${s.name || "(tanpa judul)"}`));
      return;
    }

    // Kirim ke agent (slash skill /<nama> juga — ask() yang resolve manual invocation).
    const t0 = Date.now();
    try {
      // EMORA_STREAM=1 → stream jawaban langsung dari LLM tanpa tool loop
      // (cepat terlihat, tapi tool tidak jalan). Default: ask() penuh.
      if (process.env.EMORA_STREAM === "1") {
        const { HumanMessage, SystemMessage } = await import("@langchain/core/messages");
        const { getSystemPrompt } = await import("../core/chat.js");
        process.stdout.write(C.dim("▌ "));
        const stream = await llm.stream([
          new SystemMessage(await getSystemPrompt()),
          new HumanMessage(input),
        ]);
        for await (const chunk of stream) {
          const piece = typeof chunk.content === "string" ? chunk.content : "";
          if (piece) process.stdout.write(piece);
        }
        console.log();
        console.log(dim(`  ✓ ${((Date.now() - t0) / 1000).toFixed(1)}s (stream, tanpa tool)`));
        console.log();
        return;
      }

      const answer = await ask(llm, tools, sessionId, input, { mode });
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      console.log();
      console.log(answer);
      console.log();
      console.log(dim(`  ✓ ${secs}s`));
      console.log();
    } catch (err) {
      if (err?.aborted || err?.name === "AbortError") { console.log(dim("  (dibatalkan)")); return; }
      console.error(red("  ✗ " + (err.message || "").split("\n")[0]));
    }
  }

  rl.on("line", async (line) => {
    rl.pause();
    try { await handleLine(line); }
    catch (e) { console.error(red("  ✗ " + e.message.split("\n")[0])); }
    finally { rl.resume(); rl.prompt(); }
  });

  rl.on("SIGINT", () => { if (pending) { pending = ""; rl.setPrompt(bold(cyan("> "))); console.log(dim("  (multiline dibatalkan)")); rl.prompt(); } else rl.close(); });
  rl.on("close", () => { console.log(dim("\n  sampai jumpa.")); process.exit(0); });

  rl.prompt();
}
