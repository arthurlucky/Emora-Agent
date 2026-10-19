/**
 * tools/patch.js
 *
 * Edit file in-place: cari old_string di file, ganti dengan new_string.
 * Tanpa dep `diff` — pakai perbandingan BER-BASIS BARIS bertingkat, dari
 * yang paling strict ke paling longgar, PLUS pengecekan keunikan di
 * setiap tingkat sebelum menerapkan perubahan.
 *
 * ══════════════════════════════════════════════════════════════════════
 * PERUBAHAN PENTING vs versi sebelumnya (lihat CHANGELOG.md):
 *
 * 1. UNIQUENESS CHECK — versi lama langsung mengambil kecocokan PERTAMA
 *    yang ditemukan tanpa mengecek apakah old_string muncul lebih dari
 *    sekali. Di file dengan pola berulang (mis. beberapa fungsi dengan
 *    struktur mirip), ini bisa diam-diam mengedit baris yang SALAH.
 *    Sekarang: kalau ditemukan >1 kecocokan, patch DITOLAK dan user/agent
 *    diberi tahu baris ke berapa saja yang cocok, supaya bisa mengirim
 *    ulang old_string yang lebih spesifik — ATAU set replace_all:true
 *    kalau memang semua kecocokan itu harus diganti.
 *
 * 2. DIFF PREVIEW — setiap patch sukses sekarang mengembalikan potongan
 *    diff bergaya unified-diff (@@ ... @@, baris "-"/"+") di response,
 *    supaya user bisa lihat PERSIS apa yang berubah tanpa harus buka file.
 *
 * 3. TINGKATAN STRATEGI DISEDERHANAKAN (6, dari sebelumnya 9) — beberapa
 *    strategi lama (mis. "spaces" vs "indent-flex") saling tumpang tindih
 *    dan hasilnya tidak deterministik (tumpang-tindihnya tergantung posisi
 *    baris di file, bukan pola old_string itu sendiri). Sekarang tiap
 *    tingkatan longgar STRICT lebih longgar dari tingkat sebelumnya:
 *      1. exact              — byte-perfect per baris
 *      2. trim-trailing      — abaikan whitespace di akhir baris
 *      3. whitespace-normalized — abaikan SEMUA whitespace leading/
 *                                  internal/trailing per baris
 *      4. ignore-comments    — tambahan: baris comment (// atau #) juga
 *                                dikosongkan sebelum dibandingkan
 *      5. case-insensitive   — tambahan: tidak peduli huruf besar/kecil
 *      6. prefix-anchored    — LAST RESORT, cocokkan blob mentah berbasis
 *                                60% overlap awal. RISIKO TINGGI (bisa
 *                                salah tempat) — HANYA aktif kalau caller
 *                                mengirim `allow_risky_match: true` secara
 *                                eksplisit. Tanpa itu, patch gagal dengan
 *                                pesan yang menyarankan write_file.
 *
 * 4. CRLF ditangani sebagai PRE-PROCESSING (deteksi + normalisasi ke LF
 *    di awal, dikembalikan ke CRLF di akhir kalau file aslinya CRLF),
 *    bukan sebagai satu strategi terpisah — supaya semua tingkatan di
 *    atas otomatis CRLF-safe, bukan cuma satu tingkat tertentu.
 *
 * 5. MAX_FILE_LINES hard-block DIHAPUS. Karena sekarang tiap match sudah
 *    diverifikasi unik sebelum diterapkan, patch di file besar jauh lebih
 *    aman daripada sebelumnya — cukup soft-warning di file yang sangat
 *    besar, bukan penolakan otomatis yang memaksa full-rewrite (yang
 *    justru lebih boros & lebih berisiko untuk file besar).
 * ══════════════════════════════════════════════════════════════════════
 */
import fs from "fs";
import path from "path";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { resolveWorkspacePath } from "../utils/workspace.js";

const LARGE_FILE_WARN_LINES = 2000;
const DIFF_CONTEXT_LINES = 2;
const MAX_HUNKS_SHOWN = 5;

// ─── Normalisasi per baris, satu fungsi per tingkatan ──────────────────
function normExact(line) { return line; }
function normTrimTrailing(line) { return line.replace(/[ \t]+$/, ""); }
function normWhitespace(line) { return line.trim().replace(/[ \t]+/g, " "); }
function normIgnoreComments(line) {
  const stripped = line.replace(/^\s*(\/\/|#).*$/, "");
  return stripped.trim().replace(/[ \t]+/g, " ");
}
function normCaseInsensitive(line) {
  return line.trim().replace(/[ \t]+/g, " ").toLowerCase();
}

const LINE_STRATEGIES = [
  { name: "exact", fn: normExact },
  { name: "trim-trailing", fn: normTrimTrailing },
  { name: "whitespace-normalized", fn: normWhitespace },
  { name: "ignore-comments", fn: normIgnoreComments },
  { name: "case-insensitive", fn: normCaseInsensitive },
];

/** Cari semua posisi awal (0-based, index baris) di mana blok needleLines
 *  cocok dengan haystackLines, memakai fungsi normalisasi tertentu. */
function findLineBlockMatches(haystackLines, needleLines, normFn) {
  const matches = [];
  const nLen = needleLines.length;
  if (nLen === 0 || nLen > haystackLines.length) return matches;
  const normNeedle = needleLines.map(normFn);
  for (let i = 0; i <= haystackLines.length - nLen; i++) {
    let ok = true;
    for (let j = 0; j < nLen; j++) {
      if (normFn(haystackLines[i + j]) !== normNeedle[j]) { ok = false; break; }
    }
    if (ok) matches.push(i);
  }
  return matches;
}

/** Fallback terakhir & paling berisiko: cocokkan 60% prefix awal old_string
 *  di mana pun ia muncul di content mentah (bukan per baris). Hanya dipakai
 *  kalau allow_risky_match true DAN semua tingkatan per-baris gagal. */
function prefixAnchoredMatch(content, needle) {
  const prefixLen = Math.floor(needle.length * 0.6);
  if (prefixLen < 8) return null; // needle terlalu pendek untuk fallback ini aman
  const prefix = needle.slice(0, prefixLen);
  const idx = content.indexOf(prefix);
  if (idx < 0) return null;
  return { index: idx, matchedLength: needle.length };
}

function buildHunk(origLines, startLine, oldCount, newLines) {
  const ctxStart = Math.max(0, startLine - DIFF_CONTEXT_LINES);
  const ctxEnd = Math.min(origLines.length, startLine + oldCount + DIFF_CONTEXT_LINES);
  const before = origLines.slice(ctxStart, startLine);
  const removed = origLines.slice(startLine, startLine + oldCount);
  const after = origLines.slice(startLine + oldCount, ctxEnd);
  const header = `@@ -${startLine + 1},${oldCount} +${startLine + 1},${newLines.length} @@`;
  const lines = [
    header,
    ...before.map((l) => `  ${l}`),
    ...removed.map((l) => `- ${l}`),
    ...newLines.map((l) => `+ ${l}`),
    ...after.map((l) => `  ${l}`),
  ];
  return lines.join("\n");
}

/**
 * Fungsi inti (dipakai langsung oleh test, dan oleh func tool di bawah).
 *
 * @param {string} content   isi file saat ini
 * @param {string} oldStr    teks yang dicari (bisa multi-baris)
 * @param {string} newStr    teks pengganti
 * @param {object} opts
 * @param {boolean} opts.replace_all      ganti SEMUA kecocokan, bukan cuma yang unik
 * @param {boolean} opts.allow_risky_match izinkan fallback prefix-anchored
 */
export function patchString(content, oldStr, newStr, opts = {}) {
  const { replace_all = false, allow_risky_match = false } = opts;

  const isCRLF = content.includes("\r\n");
  const workContent = isCRLF ? content.replace(/\r\n/g, "\n") : content;
  const workNeedle = isCRLF ? oldStr.replace(/\r\n/g, "\n") : oldStr;
  const workNewStr = isCRLF ? newStr.replace(/\r\n/g, "\n") : newStr;

  const haystackLines = workContent.split("\n");
  const needleLines = workNeedle.split("\n");

  let chosenStrategy = null;
  let matches = [];

  for (const strat of LINE_STRATEGIES) {
    const found = findLineBlockMatches(haystackLines, needleLines, strat.fn);
    if (found.length > 0) {
      chosenStrategy = strat.name;
      matches = found;
      break; // tingkat paling strict yang berhasil menang — jangan cek yang lebih longgar
    }
  }

  // ── Tidak ada tingkat per-baris yang cocok → coba fallback berisiko (opt-in) ──
  if (!chosenStrategy) {
    if (!allow_risky_match) {
      return {
        ok: false,
        error:
          `old_string tidak ditemukan di file (5 tingkat pencocokan per-baris sudah dicoba: ` +
          `exact, trim-trailing, whitespace-normalized, ignore-comments, case-insensitive). ` +
          `Cek ulang isi old_string, atau kirim potongan yang lebih presisi. ` +
          `Kalau yakin ini cuma soal format yang sangat berantakan, panggil ulang dengan ` +
          `allow_risky_match:true untuk mencoba pencocokan prefix 60% (BERISIKO, bisa salah tempat) — ` +
          `atau gunakan write_file untuk menulis ulang seluruh isi file.`,
      };
    }
    const risky = prefixAnchoredMatch(workContent, workNeedle);
    if (!risky) {
      return { ok: false, error: `old_string tidak ditemukan di file (termasuk fallback prefix-anchored).` };
    }
    const before = workContent.slice(0, risky.index);
    const after = workContent.slice(risky.index + risky.matchedLength);
    let result = before + workNewStr + after;
    if (isCRLF) result = result.replace(/\n/g, "\r\n");
    return {
      ok: true,
      result,
      strategy: "prefix-anchored",
      risky: true,
      diff: "(diff tidak ditampilkan untuk mode prefix-anchored — hasil TIDAK berbasis baris, WAJIB tinjau manual file setelah ini)",
    };
  }

  // ── Ambiguitas: lebih dari 1 kecocokan di tingkat yang sama ──
  if (matches.length > 1 && !replace_all) {
    const preview = matches
      .slice(0, 10)
      .map((idx) => `  • baris ${idx + 1}: ${haystackLines[idx].trim().slice(0, 80)}`)
      .join("\n");
    const more = matches.length > 10 ? `\n  ... dan ${matches.length - 10} kecocokan lainnya` : "";
    return {
      ok: false,
      error:
        `old_string DITEMUKAN TAPI AMBIGU: ${matches.length} kecocokan pada tingkat "${chosenStrategy}":\n${preview}${more}\n\n` +
        `Kirim ulang old_string dengan baris konteks tambahan di sekitarnya supaya unik, ` +
        `ATAU panggil ulang dengan replace_all:true kalau memang SEMUA kecocokan ini harus diganti sama.`,
    };
  }

  // ── Terapkan replacement (1 atau banyak kalau replace_all) ──
  const newLines = workNewStr.split("\n");
  const workingLines = haystackLines.slice();
  const hunks = [];
  // Apply dari bawah ke atas supaya index kecocokan lain tetap valid.
  const orderedMatches = [...matches].sort((a, b) => b - a);
  for (const startLine of orderedMatches) {
    hunks.unshift(buildHunk(haystackLines, startLine, needleLines.length, newLines));
    workingLines.splice(startLine, needleLines.length, ...newLines);
  }

  let result = workingLines.join("\n");
  if (isCRLF) result = result.replace(/\n/g, "\r\n");

  const shownHunks = hunks.slice(0, MAX_HUNKS_SHOWN);
  const omittedCount = hunks.length - shownHunks.length;
  const diffText =
    shownHunks.join("\n\n") +
    (omittedCount > 0 ? `\n\n... dan ${omittedCount} perubahan lain yang sama (tidak ditampilkan)` : "");

  return {
    ok: true,
    result,
    strategy: chosenStrategy,
    replacements: matches.length,
    diff: diffText,
  };
}

export const patchTool = new DynamicStructuredTool({
  name: "patch",
  description:
    "Edit file in-place: ganti old_string dengan new_string, DENGAN pengecekan keunikan (menolak & minta konteks lebih spesifik kalau old_string ditemukan >1 kali) dan mengembalikan preview diff (@@ ... @@). " +
    "5 tingkat pencocokan otomatis dari paling strict: exact → trim-trailing → whitespace-normalized → ignore-comments → case-insensitive. " +
    "Set replace_all:true untuk sengaja mengganti SEMUA kecocokan sekaligus. " +
    "Set allow_risky_match:true HANYA sebagai upaya terakhir kalau ke-5 tingkat di atas gagal (fallback prefix-anchored, berisiko salah tempat — WAJIB tinjau ulang file setelahnya). " +
    "Otomatis record snapshot ke .emora/undo/ sebelum edit (lihat tools/undo.js) — bisa di-undo kalau salah.",
  schema: z.object({
    path: z.string().describe("Path file yang akan diedit"),
    old_string: z.string().describe("Teks yang akan dicari (bisa multi-line). Sertakan cukup baris konteks di sekitarnya supaya unik di dalam file."),
    new_string: z.string().describe("Teks pengganti"),
    replace_all: z.boolean().optional().default(false).describe("Ganti SEMUA kecocokan sekaligus, bukan cuma yang unik. Default false (lebih aman)."),
    allow_risky_match: z.boolean().optional().default(false).describe("Izinkan fallback prefix-anchored (berisiko) kalau 5 tingkat normal gagal. Default false."),
  }),
  func: async ({ path: filename, old_string, new_string, replace_all = false, allow_risky_match = false }) => {
    try {
      const fp = resolveWorkspacePath(filename);
      if (!fs.existsSync(fp)) return `❌ File tidak ditemukan: ${filename}`;

      const content = fs.readFileSync(fp, "utf-8");
      const lineCount = content.split("\n").length;

      const r = patchString(content, old_string, new_string, { replace_all, allow_risky_match });
      if (!r.ok) return `❌ ${r.error}`;

      // Snapshot untuk undo (lazy import supaya tidak circular).
      try {
        const { recordSnapshot } = await import("./undo.js");
        await recordSnapshot(fp, "patch");
      } catch { /* undo.js belum ada atau error, jangan block patch */ }

      fs.writeFileSync(fp, r.result, "utf-8");

      const sizeNote = lineCount > LARGE_FILE_WARN_LINES
        ? `\n⚠️ File ini ${lineCount} baris — cukup besar, tinjau diff di bawah dengan teliti.`
        : "";
      const riskyNote = r.risky
        ? `\n⚠️ MODE BERISIKO (prefix-anchored) — hasil TIDAK diverifikasi per-baris, WAJIB baca ulang file untuk pastikan lokasi edit benar.`
        : "";
      const replCountNote = r.replacements && r.replacements > 1 ? ` (${r.replacements}x diganti)` : "";

      return (
        `✅ Patch berhasil (strategi: ${r.strategy}${replCountNote}). File "${filename}" updated.${sizeNote}${riskyNote}\n\n` +
        `\`\`\`diff\n${r.diff}\n\`\`\``
      );
    } catch (err) {
      return `❌ Error: ${err.message}`;
    }
  },
});
