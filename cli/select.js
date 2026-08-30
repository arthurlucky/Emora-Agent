/**
 * cli/select.js
 *
 * Interactive arrow-key menu. Murni Node.js built-in (raw stdin mode),
 * tidak butuh inquirer atau library tambahan apapun.
 *
 * Usage:
 *   import { select, confirm, input } from "./select.js";
 *
 *   const provider = await select("Pilih provider:", [
 *     { label: "Groq  [GRATIS]", value: "groq" },
 *     { label: "OpenAI [BAYAR]", value: "openai" },
 *   ]);
 *
 *   const ok = await confirm("Lanjutkan?");
 *   const name = await input("Masukkan nama: ");
 */

import chalk from "chalk";
import readline from "readline";

// Design tokens sebagai chalk INSTANCE (bukan arrow function)
// supaya .bold, .italic, dll bisa di-chain: cyan.bold("teks")
const C = {
  cursor:   chalk.hex("#58a6ff").bold,
  label:    chalk.hex("#e6edf3"),
  dimLabel: chalk.hex("#8b949e"),
  hint:     chalk.hex("#6e7681"),
  green:    chalk.hex("#3fb950"),
  yellow:   chalk.hex("#d29922"),
  red:      chalk.hex("#f85149"),
  purple:   chalk.hex("#a371f7"),
  cyan:     chalk.hex("#58a6ff"),
  selected: chalk.hex("#58a6ff").bold,
  border:   chalk.hex("#30363d"),
};

function hideCursor() { process.stdout.write("\x1B[?25l"); }
function showCursor() { process.stdout.write("\x1B[?25h"); }
function clearLines(n) {
  for (let i = 0; i < n; i++) {
    process.stdout.write("\x1B[1A\x1B[2K");
  }
}

/**
 * Arrow-key single-select menu.
 *
 * @param {string} question
 * @param {Array<{label:string, value:any, hint?:string, disabled?:boolean}>} choices
 * @param {{default?:number}} opts
 * @returns {Promise<any>} - value dari pilihan yang dipilih
 */
export function select(question, choices, { default: defaultIdx = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let idx = defaultIdx;
    const total = choices.length;
    let lastRenderedLines = 0;

    function render(first = false) {
      if (!first && lastRenderedLines > 0) {
        clearLines(lastRenderedLines);
      }

      const cols = process.stdout.columns || 80;
      let lineCount = 0;

      // Question line
      const qText = `  ❯ ${question}`;
      lineCount += Math.max(1, Math.ceil(qText.length / cols));
      process.stdout.write(C.cyan("  ❯ ") + chalk.bold(question) + "\n");

      // Choices (windowed to max 10 visible items for long lists like OpenRouter)
      const maxVisible = 10;
      let startIdx = Math.max(0, idx - Math.floor(maxVisible / 2));
      startIdx = Math.min(startIdx, Math.max(0, total - maxVisible));
      const endIdx = Math.min(total, startIdx + maxVisible);

      for (let i = startIdx; i < endIdx; i++) {
        const c = choices[i];
        const isSelected = i === idx;
        const isDisabled = c.disabled;
        const cursorStr = isSelected ? "  ❯ " : "    ";
        const fullText = cursorStr + c.label + (c.hint ? `  (${c.hint})` : "");
        lineCount += Math.max(1, Math.ceil(fullText.length / cols));

        let labelStr = isDisabled
          ? C.hint(c.label)
          : isSelected
          ? C.selected(c.label)
          : C.dimLabel(c.label);
        const hintStr = c.hint ? "  " + C.hint(`(${c.hint})`) : "";
        process.stdout.write((isSelected ? C.cursor("  ❯ ") : "    ") + labelStr + hintStr + "\n");
      }

      if (total > maxVisible) {
        const scrollInfo = `    … [${idx + 1}/${total}] (gunakan panah ↑↓ untuk scroll)`;
        lineCount += Math.max(1, Math.ceil(scrollInfo.length / cols));
        process.stdout.write(C.hint(scrollInfo) + "\n");
      }

      // Shortcut Hint
      const shortcutHint = `    ${chalk.dim("[ESC: kembali • CTRL+C: keluar]")}`;
      lineCount += Math.max(1, Math.ceil(shortcutHint.length / cols));
      process.stdout.write(shortcutHint + "\n");

      lastRenderedLines = lineCount;
    }

    // Initial render
    hideCursor();
    render(true);

    const startTime = Date.now();

    // Raw mode
    const stdin = process.stdin;
    stdin.resume();
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.setEncoding("utf8");

    function cleanup() {
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.removeListener("data", onKey);
      showCursor();
    }

    function onKey(key) {
      const tokens = String(key).match(/\x1b\[[A-D]|\x1b\[|\x1b|\r|\n|\x7F|\x03|[\s\S]/g) || [key];

      for (const k of tokens) {
        if (k === "\x03") { // Ctrl+C
          cleanup();
          if (lastRenderedLines > 0) clearLines(lastRenderedLines);
          process.stdout.write(C.red("  ✗ Dibatalkan (CTRL+C)\n\n"));
          process.exit(0);
        }

        if (k === "\x1b" || k === "\x1b\x1b") { // ESC key
          cleanup();
          if (lastRenderedLines > 0) clearLines(lastRenderedLines);
          process.stdout.write(C.hint("  ← Kembali (ESC)\n"));
          stdin.removeListener("data", onKey);
          resolve("__back__");
          return;
        }

        if (k === "\r" || k === "\n") {
          // Abaikan enter otomatis dari sisa buffer stdin dalam 150ms pertama
          if (Date.now() - startTime < 150) continue;

          cleanup();
          const chosen = choices[idx];
          if (!chosen || chosen.disabled) continue;
          if (lastRenderedLines > 0) clearLines(lastRenderedLines);
          process.stdout.write(
            C.cyan("  ❯ ") + chalk.bold(question) + "  " + C.green(chosen.label) + "\n"
          );
          stdin.removeListener("data", onKey);
          resolve(chosen.value);
          return;
        }

        // Arrow keys
        if (k === "\x1b[A") { // Up
          do { idx = (idx - 1 + total) % total; } while (choices[idx].disabled && idx !== defaultIdx);
          render();
        } else if (k === "\x1b[B") { // Down
          do { idx = (idx + 1) % total; } while (choices[idx].disabled && idx !== defaultIdx);
          render();
        }
      }
    }

    stdin.on("data", onKey);
  });
}

/**
 * Yes/No confirm prompt (Y/n, default Y).
 * Mendukung arrow key (kiri/kanan) ATAU ketik y/n.
 */
export function confirm(question, { default: defaultVal = true } = {}) {
  return select(question, [
    { label: "Ya", value: true },
    { label: "Tidak", value: false },
  ], { default: defaultVal ? 0 : 1 });
}

/**
 * Plain text input (non-interactive, readline biasa).
 * Dipakai untuk API key, nama, dsb yang tidak bisa pakai arrow key.
 *
 * @param {string} prompt
 * @param {string} [defaultVal]
 * @param {boolean} [secret] - true = mask input dengan ***
 */
export function input(prompt, defaultVal = "", secret = false) {
  return new Promise((resolve) => {
    process.stdin.resume();
    const rl = readline.createInterface({
      input: process.stdin,
      output: secret ? null : process.stdout,
      terminal: true,
    });

    const displayPrompt = C.cyan("  ❯ ") + chalk.bold(prompt) +
      (defaultVal ? C.hint(` [${defaultVal}]`) : "") + "  ";

    if (secret && process.stdin.isTTY) {
      // Tulis prompt manual, baca dengan echo dimatiin
      process.stdout.write(displayPrompt);
      let val = "";
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");

      function onChar(c) {
        if (c === "\r" || c === "\n") {
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          process.stdin.removeListener("data", onChar);
          process.stdout.write("\n");
          rl.close();
          resolve(val || defaultVal);
        } else if (c === "\x03") {
          process.exit(0);
        } else if (c === "\x7F") {
          val = val.slice(0, -1);
          if (process.stdout.isTTY) {
            process.stdout.clearLine(0);
            process.stdout.cursorTo(0);
            process.stdout.write(displayPrompt + "*".repeat(val.length));
          }
        } else {
          val += c;
          if (process.stdout.isTTY) process.stdout.write("*");
        }
      }
      process.stdin.on("data", onChar);
    } else {
      rl.question(displayPrompt, (ans) => {
        rl.close();
        resolve(ans.trim() || defaultVal);
      });
    }
  });
}

/**
 * Section header printer — konsisten di setup dan semua CLI commands.
 */
export function sectionHeader(title, subtitle = "") {
  const w = Math.min(process.stdout.columns || 80, 88);
  console.log();
  console.log(C.cyan.bold("  ╭─ " + title + " ") + C.border("─".repeat(Math.max(0, w - title.length - 7))));
  if (subtitle) console.log(C.cyan("  │  ") + C.dimLabel(subtitle));
  console.log(C.cyan("  │"));
}

export function sectionFooter() {
  const w = Math.min(process.stdout.columns || 80, 88);
  console.log(C.cyan.bold("  ╰" + "─".repeat(w - 3)));
  console.log();
}

export function infoLine(label, value, color = "cyan") {
  const colorFn = color === "green" ? C.green
    : color === "yellow" ? C.yellow
    : color === "red" ? C.red
    : C.cyan;
  console.log(
    C.cyan("  │  ") +
    C.dimLabel(String(label).padEnd(22)) +
    colorFn(value)
  );
}

export function successLine(msg) {
  console.log(C.cyan("  │  ") + C.green.bold("✓ ") + C.label(msg));
}

export function warnLine(msg) {
  console.log(C.cyan("  │  ") + C.yellow.bold("⚠ ") + C.label(msg));
}

export function errorLine(msg) {
  console.log(C.cyan("  │  ") + C.red.bold("✗ ") + C.label(msg));
}
