/**
 * tools/obsidian_manual.js
 *
 * MODE MANUAL Obsidian — akses vault lewat FILESYSTEM langsung (tanpa plugin
 * REST API / MCP). Dipakai saat user tidak bisa/mau install plugin "Local
 * REST API" di Obsidian.
 *
 * Vault path disimpan di OBSIDIAN_VAULT_PATH (.env) — di-set lewat
 * `emora obsidian setup` mode manual (folder picker interaktif).
 *
 * Semua operasi dibatasi di dalam vault (path traversal ditolak).
 */
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const MAX_RESULTS = 20;
const MAX_READ_CHARS = 8000;

function vaultRoot() {
  const p = process.env.OBSIDIAN_VAULT_PATH;
  if (!p || !fsSync.existsSync(p)) return null;
  return path.resolve(p);
}

/** Resolve relPath ke dalam vault — tolak keluar vault. Return abs atau null. */
function safeResolve(relPath) {
  const root = vaultRoot();
  if (!root) return null;
  const abs = path.resolve(root, relPath || "");
  if (!abs.startsWith(root)) return null; // traversal
  return abs;
}

export const obsidianManualTool = new DynamicStructuredTool({
  name: "obsidian_vault",
  description:
    "Akses vault Obsidian user lewat FILESYSTEM (mode manual, tanpa REST API). Actions: " +
    "search (cari teks di semua note .md), read (baca 1 note), write (buat/timpa note), " +
    "append (tambah di akhir note), list (daftar notes di folder), tree (struktur folder). " +
    "Path relatif terhadap root vault. Tersedia hanya kalau OBSIDIAN_VAULT_PATH dikonfigurasi.",
  schema: z.object({
    action: z.enum(["search", "read", "write", "append", "list", "tree"]),
    path: z.string().optional().describe("Path note relatif dari root vault, mis. 'Daily/2026-01-01.md'"),
    query: z.string().optional().describe("Teks yang dicari (untuk action: search)"),
    content: z.string().optional().describe("Isi note (untuk action: write/append)"),
    folder: z.string().optional().describe("Folder target untuk list/tree (default: root vault)"),
  }),
  func: async ({ action, path: relPath = "", query = "", content = "", folder = "" }) => {
    const root = vaultRoot();
    if (!root) {
      return JSON.stringify({
        success: false,
        error: "Vault tidak dikonfigurasi. Jalankan `emora obsidian setup` pilih mode manual.",
      });
    }

    try {
      switch (action) {
        case "tree": {
          const base = safeResolve(folder);
          if (!base) return "❌ Path di luar vault.";
          const lines = [];
          async function walk(dir, depth) {
            if (depth > 3) return;
            for (const e of await fs.readdir(dir, { withFileTypes: true })) {
              if (e.name.startsWith(".")) continue;
              lines.push("  ".repeat(depth) + (e.isDirectory() ? "📁 " : "📄 ") + e.name);
              if (e.isDirectory() && lines.length < 60) await walk(path.join(dir, e.name), depth + 1);
            }
          }
          await walk(base, 0);
          return `Struktur ${folder || "(root)"}:\n${lines.slice(0, 60).join("\n") || "(kosong)"}`;
        }

        case "list": {
          const base = safeResolve(folder);
          if (!base) return "❌ Path di luar vault.";
          const files = [];
          async function walk(dir) {
            for (const e of await fs.readdir(dir, { withFileTypes: true })) {
              if (files.length >= MAX_RESULTS * 5) return;
              if (e.isDirectory()) await walk(path.join(dir, e.name));
              else if (e.name.endsWith(".md")) files.push(path.relative(root, path.join(dir, e.name)));
            }
          }
          await walk(base);
          if (!files.length) return `Tidak ada note .md di "${folder || "(root)"}".`;
          return `Notes (${Math.min(files.length, MAX_RESULTS)} dari ${files.length}):\n` +
            files.slice(0, MAX_RESULTS).map((f) => "- " + f).join("\n");
        }

        case "search": {
          if (!query) return "❌ query wajib untuk action search.";
          const hits = [];
          async function walk(dir) {
            if (hits.length >= MAX_RESULTS) return;
            for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
              const full = path.join(dir, e.name);
              if (e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith(".")) await walk(full);
              else if (e.name.endsWith(".md")) {
                try {
                  const text = await fs.readFile(full, "utf8");
                  const lineIdx = text.toLowerCase().split("\n")
                    .map((l, i) => l.toLowerCase().includes(query.toLowerCase()) ? i : -1)
                    .filter((i) => i >= 0).slice(0, 3);
                  if (lineIdx.length) {
                    hits.push({ file: path.relative(root, full), lines: lineIdx.map((i) => i + 1) });
                  }
                } catch { /* skip unreadable */ }
                if (hits.length >= MAX_RESULTS) return;
              }
            }
          }
          await walk(root);
          if (!hits.length) return `Tidak ada hasil untuk "${query}".`;
          return `Ditemukan ${hits.length} file:\n` +
            hits.map((h) => `- ${h.file} (baris ${h.lines.join(", ")})`).join("\n");
        }

        case "read": {
          const abs = safeResolve(relPath);
          if (!abs) return "❌ Path di luar vault.";
          const text = await fs.readFile(abs, "utf8");
          return text.length > MAX_READ_CHARS
            ? text.slice(0, MAX_READ_CHARS) + `\n…(dipotong, total ${text.length} chars)`
            : text;
        }

        case "write": {
          const abs = safeResolve(relPath);
          if (!abs) return "❌ Path di luar vault.";
          await fs.mkdir(path.dirname(abs), { recursive: true });
          await fs.writeFile(abs, content ?? "", "utf8");
          return `✅ Note tersimpan: ${relPath} (${(content || "").length} chars)`;
        }

        case "append": {
          const abs = safeResolve(relPath);
          if (!abs) return "❌ Path di luar vault.";
          await fs.mkdir(path.dirname(abs), { recursive: true });
          const existing = fsSync.existsSync(abs) ? await fs.readFile(abs, "utf8") : "";
          await fs.writeFile(abs, existing + (existing && !existing.endsWith("\n") ? "\n" : "") + (content ?? ""), "utf8");
          return `✅ Ditambahkan ke ${relPath}.`;
        }

        default:
          return `❌ Action tidak dikenal: ${action}`;
      }
    } catch (err) {
      return `❌ ${err.message}`;
    }
  },
});

export default obsidianManualTool;
