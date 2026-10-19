import fs   from "fs";
import path from "path";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { resolveWorkspacePath } from "../utils/workspace.js";

const MAX_WRITE_BYTES = 500 * 1024; // 500KB per write

export const writeFileTool = new DynamicStructuredTool({
  name       : "write_file",
  description: "Buat file BARU atau rewrite total (max 500KB). Untuk edit parsial file yang ada, gunakan patch (ada diff preview + uniqueness check). Otomatis snapshot untuk undo.",
  schema     : z.object({
    path   : z.string().min(1).max(500).describe("Path file"),
    content: z.string().max(MAX_WRITE_BYTES).describe("Konten teks (max 500KB)"),
  }),
  func: async ({ path: filename, content }) => {
    try {
      if (!filename?.trim()) return "❌ path kosong. Contoh: path='notes.txt'.";
      if (content.length > MAX_WRITE_BYTES) {
        return `❌ Konten ${Math.round(content.length / 1024)}KB > 500KB. Pecah jadi beberapa file atau tulis bertahap via patch.`;
      }
      // Tolak null-byte (indikasi biner).
      if (content.includes("\0")) return "❌ Konten mengandung null-byte (biner). write_file hanya untuk teks.";
      const fp  = resolveWorkspacePath(filename);
      const dir = path.dirname(fp);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // Snapshot sebelum overwrite (untuk undo). Lazy import agar tidak
      // circular kalau tools/undo.js someday import write_file.
      try {
        const { recordSnapshot } = await import("./undo.js");
        await recordSnapshot(fp, "write");
      } catch { /* undo belum ada atau error, jangan block write */ }

      fs.writeFileSync(fp, content, "utf-8");
      const lines = content.split("\n").length;
      return `✅ File "${filename}" ditulis (${lines} baris, ${content.length} chars). Untuk edit parsial berikutnya gunakan patch.`;
    } catch (err) {
      return `❌ Error: ${err.message}`;
    }
  },
});
