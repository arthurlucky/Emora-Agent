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

// Warna shared — diselaraskan dengan design token di main.js
const C = {
  cursor:  (t) => chalk.hex("#58a6ff").bold(t),
  label:   (t) => chalk.hex("#e6edf3")(t),
  dimLabel:(t) => chalk.hex("#8b949e")(t),
  hint:    (t) => chalk.hex("#6e7681")(t),
  green:   (t) => chalk.hex("#3fb950")(t),
  yellow:  (t) => chalk.hex("#d29922")(t),
  red:     (t) => chalk.hex("#f85149")(t),
  purple:  (t) => chalk.hex("#a371f7")(t),
  cyan:    (t) => chalk.hex("#58a6ff")(t),
  selected:(t) => chalk.hex("#58a6ff").bold(t),
  border:  (t) => chalk.hex("#30363d")(t),
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

    function render(first = false) {
      if (!first) clearLines(total + 1);

      // Question line
      process.stdout.write(
        C.cyan("  ❯ ") + chalk.bold(question) + "\n"
      );

      // Choices
      choices.forEach((c, i) => {
        const isSelected = i === idx;
        const isDisabled = c.disabled;
        const cursor = isSelected ? C.cursor("  ❯ ") : "    ";
        let labelStr = isDisabled
          ? C.hint(c.label)
          : isSelected
          ? C.selected(c.label)
          : C.dimLabel(c.label);
        const hintStr = c.hint ? "  " + C.hint(`(${c.hint})`) : "";
        process.stdout.write(cursor + labelStr + hintStr + "\n");
      });
    }

    // Initial render
    hideCursor();
    render(true);

    // Raw mode
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    const wasPaused = !stdin.readable;

    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    function cleanup() {
      if (stdin.isTTY) stdin.setRawMode(wasRaw || false);
      if (wasPaused) stdin.pause();
      stdin.removeListener("data", onKey);
      showCursor();
    }

    function onKey(key) {
      if (key === "\x03") { // Ctrl+C
        cleanup();
        clearLines(total + 1);
        process.stdout.write(C.red("  ✗ Dibatalkan\n\n"));
        process.exit(0);
      }

      if (key === "\r" || key === "\n") {
        cleanup();
        const chosen = choices[idx];
        if (chosen.disabled) return; // jangan resolve kalau disabled
        clearLines(total + 1);
        process.stdout.write(
          C.cyan("  ❯ ") + chalk.bold(question) + "  " + C.green(chosen.label) + "\n"
        );
        resolve(chosen.value);
        return;
      }

      // Arrow keys
      if (key === "\x1B[A") { // Up
        do { idx = (idx - 1 + total) % total; } while (choices[idx].disabled && idx !== defaultIdx);
      } else if (key === "\x1B[B") { // Down
        do { idx = (idx + 1) % total; } while (choices[idx].disabled && idx !== defaultIdx);
      }

      render();
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
    const rl = readline.createInterface({
      input: process.stdin,
      output: secret ? null : process.stdout,
      terminal: true,
    });

    const displayPrompt = C.cyan("  ❯ ") + chalk.bold(prompt) +
      (defaultVal ? C.hint(` [${defaultVal}]`) : "") + "  ";

    if (secret) {
      // Tulis prompt manual, baca dengan echo dimatiin
      process.stdout.write(displayPrompt);
      let val = "";
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");

      function onChar(c) {
        if (c === "\r" || c === "\n") {
          if (process.stdin.isTTY) process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onChar);
          process.stdout.write("\n");
          rl.close();
          resolve(val || defaultVal);
        } else if (c === "\x03") {
          process.exit(0);
        } else if (c === "\x7F") {
          val = val.slice(0, -1);
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          process.stdout.write(displayPrompt + "*".repeat(val.length));
        } else {
          val += c;
          process.stdout.write("*");
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
  console.log(chalk.hex("#58a6ff").bold("  ╭─ " + title + " ") + chalk.hex("#30363d")("─".repeat(Math.max(0, w - title.length - 7))));
  if (subtitle) console.log(chalk.hex("#58a6ff")("  │  ") + chalk.hex("#8b949e")(subtitle));
  console.log(chalk.hex("#58a6ff")("  │"));
}

export function sectionFooter() {
  const w = Math.min(process.stdout.columns || 80, 88);
  console.log(chalk.hex("#58a6ff").bold("  ╰" + "─".repeat(w - 3)));
  console.log();
}

export function infoLine(label, value, color = "cyan") {
  const colorFn = color === "green" ? chalk.hex("#3fb950")
    : color === "yellow" ? chalk.hex("#d29922")
    : color === "red" ? chalk.hex("#f85149")
    : chalk.hex("#58a6ff");
  console.log(
    chalk.hex("#58a6ff")("  │  ") +
    chalk.hex("#8b949e")(String(label).padEnd(22)) +
    colorFn(value)
  );
}

export function successLine(msg) {
  console.log(chalk.hex("#58a6ff")("  │  ") + chalk.hex("#3fb950").bold("✓ ") + chalk.hex("#e6edf3")(msg));
}

export function warnLine(msg) {
  console.log(chalk.hex("#58a6ff")("  │  ") + chalk.hex("#d29922").bold("⚠ ") + chalk.hex("#e6edf3")(msg));
}

export function errorLine(msg) {
  console.log(chalk.hex("#58a6ff")("  │  ") + chalk.hex("#f85149").bold("✗ ") + chalk.hex("#e6edf3")(msg));
}
