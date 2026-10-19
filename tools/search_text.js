/**
 * tools/search_text.js
 *
 * "grep" sungguhan untuk EMORA — REWRITE dari versi lama yang cuma
 * substring match linear per baris tanpa regex/context/glob-filter dan
 * membaca SELURUH file repo satu-satu ke memori (lambat di repo besar).
 *
 * ══════════════════════════════════════════════════════════════════════
 * STRATEGI:
 *   1. Kalau binary `ripgrep` (rg) tersedia di PATH sistem — pakai itu
 *      (via `rg --json`). Ini yang dipakai tool grep di Claude Code/Codex
 *      dkk: jauh lebih cepat (multi-thread, native), otomatis menghormati
 *      .gitignore, dan mendukung regex penuh.
 *   2. Kalau `rg` TIDAK ada (banyak device Termux/VPS minimal tidak
 *      install ripgrep) — fallback ke implementasi JS murni yang sekarang
 *      MENDUKUNG hal yang sama (regex, context lines, glob filter),
 *      supaya perilaku tool ini konsisten terlepas dari environment.
 *
 * FITUR BARU vs versi lama:
 *   - `regex`: true/false — cari pakai regular expression, bukan cuma substring.
 *   - `case_sensitive`: default false (dulu implisit selalu case-sensitive).
 *   - `context_lines`: berapa baris konteks sebelum/sesudah tiap match (mirip `grep -C`).
 *   - `glob`: filter file (mis. "**" + "/*.js") — dulu selalu men-scan SEMUA file.
 *   - `path`: batasi pencarian ke sub-folder tertentu, bukan selalu seluruh workspace.
 *   - `max_results` bisa diatur (dulu hardcoded 100).
 * ══════════════════════════════════════════════════════════════════════
 */
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { spawn } from "child_process";
import fg from "fast-glob";

import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { resolveWorkspacePath } from "../utils/workspace.js";

const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/.nuxt/**",
  "**/.output/**",
  "**/downloads/**",
  "**/uploads/**",
  "**/memory/**",
  "**/backups/**",
  "**/skill_factory/**",
];

let rgAvailableCache = null;

function checkRipgrepAvailable() {
  if (rgAvailableCache !== null) return Promise.resolve(rgAvailableCache);
  return new Promise((resolve) => {
    const child = spawn("rg", ["--version"], { stdio: "ignore" });
    child.on("error", () => { rgAvailableCache = false; resolve(false); });
    child.on("close", (code) => { rgAvailableCache = code === 0; resolve(rgAvailableCache); });
  });
}

/** Jalankan `rg --json` dan parse output jadi array hasil seragam. */
function runRipgrep({ query, root, regex, case_sensitive, context_lines, glob, max_results }) {
  return new Promise((resolve, reject) => {
    const args = ["--json", "--max-count", "200"];
    if (!case_sensitive) args.push("-i");
    if (!regex) args.push("-F");
    if (context_lines > 0) args.push("-C", String(context_lines));
    if (glob) args.push("-g", glob);
    for (const ig of DEFAULT_IGNORE) {
      // fast-glob style "**/x/**" -> ripgrep glob negation "!x/**"
      const rgGlob = "!" + ig.replace(/^\*\*\//, "").replace(/\/\*\*$/, "/**");
      args.push("-g", rgGlob);
    }
    args.push("--", query, root);

    const child = spawn("rg", args, { cwd: root });
    let buf = "";
    let errBuf = "";
    child.stdout.on("data", (d) => { buf += d.toString(); });
    child.stderr.on("data", (d) => { errBuf += d.toString(); });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      // rg exit code 1 = "no matches found" (bukan error), 2 = error sungguhan
      if (code === 2) return reject(new Error(errBuf.trim() || "ripgrep error"));

      const results = [];
      const byFile = new Map();
      for (const line of buf.split("\n")) {
        if (!line.trim()) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }
        if (evt.type !== "match" && evt.type !== "context") continue;
        const file = evt.data.path.text;
        const lineNo = evt.data.line_number;
        const text = (evt.data.lines.text || "").replace(/\n$/, "");
        if (!byFile.has(file)) byFile.set(file, []);
        byFile.get(file).push({ line: lineNo, text, isMatch: evt.type === "match" });
      }
      for (const [file, entries] of byFile) {
        entries.sort((a, b) => a.line - b.line);
        for (const e of entries) {
          if (!e.isMatch) continue;
          const idx = entries.indexOf(e);
          results.push({
            file,
            line: e.line,
            text: e.text.trim(),
            context: {
              before: entries.slice(Math.max(0, idx - context_lines), idx).map((c) => ({ line: c.line, text: c.text })),
              after: entries.slice(idx + 1, idx + 1 + context_lines).map((c) => ({ line: c.line, text: c.text })),
            },
          });
          if (results.length >= max_results) return resolve(results);
        }
      }
      resolve(results);
    });
  });
}

/** Fallback JS murni — dipakai kalau `rg` tidak terpasang di sistem. */
async function runJsFallback({ query, root, regex, case_sensitive, context_lines, glob, max_results }) {
  const files = await fg(glob || "**/*", {
    cwd: root,
    absolute: true,
    onlyFiles: true,
    ignore: DEFAULT_IGNORE,
  });

  let matcher;
  if (regex) {
    matcher = new RegExp(query, case_sensitive ? "" : "i");
  } else {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    matcher = new RegExp(escaped, case_sensitive ? "" : "i");
  }

  const results = [];
  for (const file of files) {
    if (results.length >= max_results) break;
    let content;
    try {
      content = await fs.readFile(file, "utf8");
    } catch { continue; } // file biner atau tidak terbaca -> skip diam-diam

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (results.length >= max_results) break;
      if (!matcher.test(lines[i])) continue;

      const before = [];
      for (let b = Math.max(0, i - context_lines); b < i; b++) before.push({ line: b + 1, text: lines[b] });
      const after = [];
      for (let a = i + 1; a <= Math.min(lines.length - 1, i + context_lines); a++) after.push({ line: a + 1, text: lines[a] });

      results.push({ file, line: i + 1, text: lines[i].trim(), context: { before, after } });
    }
  }
  return results;
}

export const searchTextTool = new DynamicStructuredTool({
  name: "search_text",

  description:
    "Cari teks/pola di seluruh file workspace (mirip `grep -rn`). Pakai `rg` (ripgrep) kalau tersedia di sistem, otomatis fallback ke pencarian JS kalau tidak. " +
    "Mendukung regex (regex:true), context line di sekitar match (context_lines), filter glob per jenis file (glob: \"**/*.js\"), dan pembatasan folder (path). " +
    "Selalu mengabaikan node_modules/.git/dist/dll secara default.",

  schema: z.object({
    query: z.string().describe("Teks atau pola regex yang dicari"),
    regex: z.boolean().optional().default(false).describe("Perlakukan query sebagai regular expression. Default false (substring literal)."),
    case_sensitive: z.boolean().optional().default(false).describe("Default false — pencarian tidak peduli huruf besar/kecil."),
    context_lines: z.number().int().min(0).max(20).optional().default(0).describe("Jumlah baris konteks ditampilkan sebelum & sesudah tiap match (mirip grep -C)."),
    glob: z.string().optional().describe("Filter file, mis. \"**/*.js\" atau \"src/**/*.ts\". Kosongkan untuk semua file."),
    path: z.string().optional().describe("Batasi pencarian ke sub-folder ini (relatif ke workspace). Kosongkan untuk seluruh workspace."),
    max_results: z.number().int().min(1).max(500).optional().default(100).describe("Maksimal jumlah match yang dikembalikan."),
  }),

  async func({ query, regex = false, case_sensitive = false, context_lines = 0, glob, path: subPath, max_results = 100 }) {
    const root = resolveWorkspacePath(subPath || "");
    if (!fsSync.existsSync(root)) return `❌ Folder tidak ditemukan: ${subPath}`;

    const opts = { query, root, regex, case_sensitive, context_lines, glob, max_results };

    try {
      const hasRg = await checkRipgrepAvailable();
      const results = hasRg ? await runRipgrep(opts) : await runJsFallback(opts);
      if (!results.length) {
        return JSON.stringify({ engine: hasRg ? "ripgrep" : "js-fallback", matches: 0, results: [] }, null, 2);
      }
      return JSON.stringify({ engine: hasRg ? "ripgrep" : "js-fallback", matches: results.length, results }, null, 2);
    } catch (err) {
      // rg gagal jalan (mis. flag tidak didukung versi lama) -> fallback JS supaya tool tetap berguna.
      try {
        const results = await runJsFallback(opts);
        return JSON.stringify({ engine: "js-fallback", note: `ripgrep error diabaikan: ${err.message}`, matches: results.length, results }, null, 2);
      } catch (fallbackErr) {
        return `❌ Error: ${fallbackErr.message}`;
      }
    }
  },
});
export default searchTextTool;
