/**
 * tui/markdown.js
 *
 * Render markdown ke baris-baris teks yang sudah diberi warna (chalk) buat
 * ditampilkan di viewport chat TUI. Bukan parser CommonMark lengkap —
 * cukup buat menangani gaya balasan LLM yang umum (heading, bold/italic,
 * inline code, fenced code block + syntax highlight, list, blockquote,
 * table, horizontal rule).
 */
import chalk from "chalk";
import { highlight, supportsLanguage } from "cli-highlight";
import { C, stripAnsi, hr } from "./styles.js";

// ── Inline styling (bold/italic/inline code) ────────────────────────────────
function styleInline(text) {
  // Inline code duluan supaya isinya gak ikut ke-parse sebagai bold/italic.
  let out = "";
  let i = 0;
  const n = text.length;

  while (i < n) {
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        out += C.purple(text.slice(i + 1, end));
        i = end + 1;
        continue;
      }
    }
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        out += chalk.bold(text.slice(i + 2, end));
        i = end + 2;
        continue;
      }
    }
    if ((text[i] === "*" || text[i] === "_") && text[i + 1] !== " ") {
      const marker = text[i];
      const end = text.indexOf(marker, i + 1);
      if (end !== -1 && text[end - 1] !== " ") {
        out += chalk.italic(text.slice(i + 1, end));
        i = end + 1;
        continue;
      }
    }
    out += text[i];
    i++;
  }
  return out;
}

/** Patahkan satu "kata" (sudah distyle chalk) yang lebih panjang dari width,
 *  dengan mempertahankan kode ANSI pembuka/penutup di tiap potongan. */
function hardBreakStyledWord(word, width) {
  const m = word.match(/^((?:\x1b\[[0-9;]*m)*)([\s\S]*?)((?:\x1b\[[0-9;]*m)*)$/);
  const [, prefix = "", inner = word, suffix = ""] = m || [];
  if (stripAnsi(inner).length <= width) return [word];

  const chunks = [];
  for (let i = 0; i < inner.length; i += width) {
    chunks.push(prefix + inner.slice(i, i + width) + suffix);
  }
  return chunks;
}

/** Word-wrap teks yang sudah distyle (chalk), dihitung dari lebar VISIBLE-nya. */
function wrapStyled(styled, width) {
  if (width <= 10) width = 10;
  // Styling diterapkan per kata supaya batas ANSI code gak pernah motong
  // di tengah kata — cukup akurat buat balasan LLM & jauh lebih simpel
  // daripada tokenisasi ANSI karakter-per-karakter.
  const rawWords = styled.split(" ");
  const words = [];
  for (const w of rawWords) words.push(...hardBreakStyledWord(w, width));

  const lines = [];
  let cur = "";
  let curVisible = 0;

  for (const w of words) {
    const wLen = stripAnsi(w).length;
    const extra = curVisible === 0 ? wLen : curVisible + 1 + wLen;
    if (extra > width && curVisible > 0) {
      lines.push(cur);
      cur = w;
      curVisible = wLen;
    } else {
      cur = curVisible === 0 ? w : cur + " " + w;
      curVisible = extra;
    }
  }
  if (cur.length || !lines.length) lines.push(cur);
  return lines;
}

// ── Table rendering ──────────────────────────────────────────────────────────
function isTableSeparator(line) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");
}

function parseTableRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

function renderTable(rows, width) {
  if (rows.length < 2) return rows.map((r) => styleInline(r));
  const header = parseTableRow(rows[0]);
  const body = rows.slice(2).map(parseTableRow);

  const colWidths = header.map((h, i) => {
    const cellLens = body.map((r) => (r[i] || "").length);
    return Math.max(h.length, ...cellLens, 3);
  });

  // Kalau kelebaran layar, ciutkan proporsional
  const totalWidth = colWidths.reduce((a, b) => a + b + 3, 1);
  const scale = totalWidth > width ? width / totalWidth : 1;
  const finalWidths = colWidths.map((w) => Math.max(3, Math.floor(w * scale)));

  const renderRow = (cells, isHeader) => {
    const parts = cells.map((cell, i) => {
      const w = finalWidths[i] || 6;
      const text = (cell || "").length > w ? cell.slice(0, w - 1) + "…" : (cell || "");
      const padded = text + " ".repeat(Math.max(0, w - text.length));
      return isHeader ? chalk.bold(C.primary(padded)) : styleInline(padded);
    });
    return C.border("│ ") + parts.join(C.border(" │ ")) + C.border(" │");
  };

  const sep = C.border("├" + finalWidths.map((w) => "─".repeat(w + 2)).join("┼") + "┤");
  const top = C.border("┌" + finalWidths.map((w) => "─".repeat(w + 2)).join("┬") + "┐");
  const bottom = C.border("└" + finalWidths.map((w) => "─".repeat(w + 2)).join("┴") + "┘");

  const out = [top, renderRow(header, true), sep];
  for (const row of body) out.push(renderRow(row, false));
  out.push(bottom);
  return out;
}

// ── Code block syntax highlighting ──────────────────────────────────────────
function renderCodeBlock(lines, lang) {
  const code = lines.join("\n");
  let highlighted;
  try {
    const language = lang && supportsLanguage(lang) ? lang : undefined;
    highlighted = highlight(code, { language, ignoreIllegals: true });
  } catch {
    highlighted = code;
  }
  const codeLines = highlighted.split("\n");
  const out = [C.border("  ┌─" + (lang ? ` ${lang} ` : "") + "─".repeat(Math.max(0, 20 - (lang || "").length)))];
  for (const l of codeLines) out.push(C.border("  │ ") + l);
  out.push(C.border("  └" + "─".repeat(22)));
  return out;
}

// ── Main entry point ─────────────────────────────────────────────────────────
/**
 * @param {string} text - markdown mentah
 * @param {number} width - lebar viewport dalam kolom
 * @returns {string[]} baris-baris siap tampil (sudah ada kode ANSI warna)
 */
export function renderMarkdown(text, width = 80) {
  if (!text) return [];
  const srcLines = String(text).replace(/\r\n/g, "\n").split("\n");
  const out = [];

  let i = 0;
  let tableBuf = [];

  const flushTable = () => {
    if (tableBuf.length) {
      out.push(...renderTable(tableBuf, width));
      tableBuf = [];
    }
  };

  while (i < srcLines.length) {
    const line = srcLines[i];

    // Fenced code block
    const fenceMatch = line.match(/^\s*```\s*(\S*)\s*$/);
    if (fenceMatch) {
      flushTable();
      const lang = fenceMatch[1];
      const codeLines = [];
      i++;
      while (i < srcLines.length && !/^\s*```/.test(srcLines[i])) {
        codeLines.push(srcLines[i]);
        i++;
      }
      i++; // skip closing fence
      out.push(...renderCodeBlock(codeLines, lang));
      continue;
    }

    // Table (heuristic: current line has '|' and next line is a separator)
    if (line.includes("|") && srcLines[i + 1] && isTableSeparator(srcLines[i + 1])) {
      flushTable();
      tableBuf.push(line, srcLines[i + 1]);
      i += 2;
      while (i < srcLines.length && srcLines[i].includes("|") && srcLines[i].trim()) {
        tableBuf.push(srcLines[i]);
        i++;
      }
      flushTable();
      continue;
    }
    flushTable();

    // Headers
    const headerMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const headerText = styleInline(headerMatch[2]);
      const color = level === 1 ? C.primaryBold : level === 2 ? C.purple.bold : chalk.bold;
      out.push(color(headerText));
      if (level <= 2) out.push(hr(Math.min(width, stripAnsi(headerText).length + 2)));
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push(hr(width));
      i++;
      continue;
    }

    // Blockquote
    const quoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      const wrapped = wrapStyled(styleInline(quoteMatch[1]), Math.max(10, width - 2));
      for (const w of wrapped) out.push(C.faint("│ ") + C.dim(w));
      i++;
      continue;
    }

    // List items
    const bulletMatch = line.match(/^(\s*)([-*])\s+(.*)$/);
    const numberedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (bulletMatch || numberedMatch) {
      const indent = (bulletMatch || numberedMatch)[1].length;
      const marker = bulletMatch ? C.primary("•") : C.primary(numberedMatch[2] + ".");
      const content = (bulletMatch || numberedMatch)[3];
      const prefix = " ".repeat(indent) + marker + " ";
      const wrapped = wrapStyled(styleInline(content), Math.max(10, width - stripAnsi(prefix).length));
      out.push(prefix + (wrapped[0] || ""));
      for (const w of wrapped.slice(1)) out.push(" ".repeat(stripAnsi(prefix).length) + w);
      i++;
      continue;
    }

    // Blank line
    if (!line.trim()) {
      out.push("");
      i++;
      continue;
    }

    // Plain paragraph
    const wrapped = wrapStyled(styleInline(line), width);
    out.push(...wrapped);
    i++;
  }

  flushTable();
  return out;
}
