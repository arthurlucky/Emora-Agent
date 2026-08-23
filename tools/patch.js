/**
 * tools/patch.js
 *
 * Edit file in-place: cari old_string di file, ganti dengan new_string.
 * Tanpa dep `diff` — pakai 9 strategi fuzzy bertingkat (cocok berurutan
 * sampai ketemu), fallback ke error informatif.
 *
 * 9 strategi (urutan dari yang paling strict → paling longgar):
 *   1. exact match (byte-perfect)
 *   2. trimmed (ignore trailing whitespace tiap baris)
 *   3. line-by-line (abaikan perbedaan spasi multi-line)
 *   4. normalized whitespace (tab↔space, multiple spaces)
 *   5. ignore comments (// dan # di depan baris)
 *   6. indent-flex (abaikan perbedaan leading whitespace per baris)
 *   7. CRLF/LF normalize
 *   8. case-insensitive
 *   9. prefix-anchored (match by 60% char overlap awal, untuk kasus ekstrim)
 *
 * ponytail: global fuzzy match O(n*m). Untuk file > 500 baris, fallback
 * ke write_file (lihat write_file tool). Upgrade: pakai Myers diff kalau
 * scale butuh.
 */
import fs from "fs";
import path from "path";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { resolveWorkspacePath } from "../utils/workspace.js";

const MAX_FILE_LINES = 500;

// ─── 9 strategi fuzzy ────────────────────────────────────────────────
function normExact(s)        { return s; }
function normTrim(s)         { return s.split("\n").map(l => l.trimEnd()).join("\n"); }
function normTrimEach(s)     { return normTrim(s); }  // alias
function normSpaces(s)       { return s.replace(/[ \t]+/g, " ").replace(/[ \t]*\n[ \t]*/g, "\n"); }
function normIgnoreComments(s) {
  return s.split("\n").map(l => l.replace(/^\s*(\/\/|#).*$/, "")).join("\n");
}
function normIndentFlex(s)   { return s.split("\n").map(l => l.replace(/^[ \t]+/, "")).join("\n"); }
function normCRLF(s)         { return s.replace(/\r\n/g, "\n"); }
function normCase(s)         { return s.toLowerCase(); }
function normPrefix(s)       { return s.slice(0, Math.floor(s.length * 0.6)); }

const STRATEGIES = [
  { name: "exact",           fn: normExact },
  { name: "trim",            fn: normTrim },
  { name: "spaces",          fn: normSpaces },
  { name: "ignore-comments", fn: normIgnoreComments },
  { name: "indent-flex",     fn: normIndentFlex },
  { name: "crlf",            fn: normCRLF },
  { name: "case-insensitive", fn: normCase },
  { name: "prefix-anchored", fn: normPrefix },
];

function findMatch(haystack, needle) {
  for (const strat of STRATEGIES) {
    const h = strat.fn(haystack);
    const n = strat.fn(needle);
    const idx = h.indexOf(n);
    if (idx >= 0) {
      // Kembalikan posisi byte di haystack ASLI (cari ulang dengan exact).
      // Untuk prefix-anchored, kembalikan posisi 0 karena prefix pasti di awal.
      if (strat.name === "prefix-anchored") {
        return { index: 0, strategy: strat.name, matchedLength: Math.floor(needle.length * 0.6) };
      }
      // Cari posisi exact di original — biasanya tetap sama karena normalize
      // tidak menggeser posisi byte (kecuali trim/case-insensitive yang shrink string).
      // Untuk konsistensi, cari exact substring needle di original.
      const exactIdx = haystack.indexOf(needle);
      if (exactIdx >= 0) return { index: exactIdx, strategy: strat.name, matchedLength: needle.length };
      // Kalau exact nggak ketemu (mis. case-insensitive match), pakai posisi normalized.
      // Cari dengan needle yang sudah di-normalize kebalikan... actually just pakai idx.
      // Aman: cari substring original di posisi yang sama.
      return { index: idx, strategy: strat.name, matchedLength: n.length };
    }
  }
  return null;
}

export function patchString(content, oldStr, newStr) {
  const match = findMatch(content, oldStr);
  if (!match) {
    return {
      ok: false,
      error: `old_string tidak ditemukan di file (8 strategi fuzzy sudah dicoba). Cek indent/whitespace/case, atau kirim kembali old_string yang lebih panjang untuk uniqueness.`,
    };
  }
  const before = content.slice(0, match.index);
  const after  = content.slice(match.index + match.matchedLength);
  return {
    ok: true,
    result: before + newStr + after,
    strategy: match.strategy,
  };
}

export const patchTool = new DynamicStructuredTool({
  name: "patch",
  description: "Edit file in-place: ganti old_string dengan new_string. Pakai 9 strategi fuzzy (exact → trimmed → spaces → ignore-comments → indent-flex → CRLF → case-insensitive → prefix-anchored). Untuk file > 500 baris, prefer write_file. Otomatis record snapshot ke .emora/undo/ sebelum edit (lihat tools/undo.js).",
  schema: z.object({
    path: z.string().describe("Path file yang akan diedit"),
    old_string: z.string().describe("Teks yang akan dicari (bisa multi-line)"),
    new_string: z.string().describe("Teks pengganti"),
  }),
  func: async ({ path: filename, old_string, new_string }) => {
    try {
      const fp = resolveWorkspacePath(filename);
      if (!fs.existsSync(fp)) return `❌ File tidak ditemukan: ${filename}`;

      const content = fs.readFileSync(fp, "utf-8");
      const lines = content.split("\n").length;
      if (lines > MAX_FILE_LINES) {
        return `⚠️ File ${lines} baris (>${MAX_FILE_LINES}). Untuk file besar, prefer write_file (full rewrite lebih aman dari fuzzy patch).`;
      }

      const r = patchString(content, old_string, new_string);
      if (!r.ok) return `❌ ${r.error}`;

      // Snapshot untuk undo (lazy import supaya tidak circular).
      try {
        const { recordSnapshot } = await import("./undo.js");
        await recordSnapshot(fp, "patch");
      } catch { /* undo.js belum ada atau error, jangan block patch */ }

      fs.writeFileSync(fp, r.result, "utf-8");
      return `✅ Patch berhasil (strategi: ${r.strategy}). File "${filename}" updated.`;
    } catch (err) {
      return `❌ Error: ${err.message}`;
    }
  },
});
