/**
 * tui/styles.js
 *
 * Design tokens buat TUI baru. Sengaja REUSE palet warna yang sudah
 * dipakai EMORA di cli/select.js & main.js (bukan palet dari sumber Go-nya)
 * supaya TUI terasa konsisten dengan sisa CLI EMORA yang sudah ada.
 */
import chalk from "chalk";

export const C = {
  primary: chalk.hex("#58a6ff"),
  primaryBold: chalk.hex("#58a6ff").bold,
  text: chalk.hex("#e6edf3"),
  dim: chalk.hex("#8b949e"),
  faint: chalk.hex("#6e7681"),
  green: chalk.hex("#3fb950"),
  yellow: chalk.hex("#d29922"),
  red: chalk.hex("#f85149"),
  purple: chalk.hex("#a371f7"),
  border: chalk.hex("#30363d"),
  bold: chalk.bold,
  inverse: chalk.inverse,
};

export const ICONS = {
  user: "❯",
  agent: "◆",
  tool: "▸",
  skill: "◈",
  ok: "✔",
  fail: "✘",
  warn: "⚠",
  info: "ℹ",
  spark: "✦",
  bullet: "•",
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export function spinnerFrame(tick) {
  return SPINNER_FRAMES[tick % SPINNER_FRAMES.length];
}

/** Garis horizontal selebar `width`, dipakai buat divider antar section. */
export function hr(width, ch = "─") {
  return C.border(ch.repeat(Math.max(0, width)));
}

/** Potong string ke `width` kolom tampilan (aman buat multibyte umum/emoji sederhana). */
export function truncate(str, width) {
  if (!str) return "";
  if (str.length <= width) return str;
  if (width <= 1) return str.slice(0, width);
  return str.slice(0, width - 1) + "…";
}

/** Ratakan kiri ke `width` kolom, mengabaikan kode ANSI saat menghitung panjang. */
export function padVisible(str, width) {
  const visibleLen = stripAnsi(str).length;
  const pad = Math.max(0, width - visibleLen);
  return str + " ".repeat(pad);
}

export function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return String(str).replace(/\x1B\[[0-9;]*m/g, "");
}

export function visibleLength(str) {
  return stripAnsi(str).length;
}

/** Bungkus teks polos (tanpa kode ANSI di dalamnya) ke banyak baris selebar `width`. */
export function wrapPlain(text, width) {
  if (width <= 0) return [text];
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (let w of words) {
    // Kata tunggal yang lebih panjang dari width (URL/hash/base64 panjang
    // tanpa spasi) — patahkan paksa per-karakter supaya gak overflow.
    while (w.length > width) {
      if (cur.length) { lines.push(cur); cur = ""; }
      lines.push(w.slice(0, width));
      w = w.slice(width);
    }
    if (!cur.length) { cur = w; continue; }
    if ((cur + " " + w).length > width) {
      lines.push(cur);
      cur = w;
    } else {
      cur += " " + w;
    }
  }
  if (cur.length) lines.push(cur);
  return lines.length ? lines : [""];
}

export function badge(text, color = C.primary) {
  return color.inverse(` ${text} `);
}
