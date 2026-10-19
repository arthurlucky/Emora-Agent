import fs from "fs";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { resolveWorkspacePath } from "../utils/workspace.js";

const MAX_READ_BYTES = 100 * 1024; // 100KB — lebih besar tulis ke file & referensikan path
const MAX_OUTPUT_CHARS = 12_000; // selaras guard chat.js (head+tail)

function isBinary(buf) {
  // Heuristik null-byte dalam 8KB pertama.
  const sample = buf.subarray(0, 8192);
  return sample.includes(0);
}

export const readFileTool = new DynamicStructuredTool({
  name       : "read_file",
  description: "Baca isi file teks (max 100KB, auto head+tail jika >12k chars). Tolak file biner.",
  schema     : z.object({
    path: z.string().min(1).max(500).describe(
      "Path file, contoh: 'notes.txt'"
    ),
    offset: z.number().int().min(0).optional().describe("Baris mulai (0-based) untuk file besar"),
    limit: z.number().int().min(1).max(2000).optional().describe("Maks baris dibaca (default semua s/d 12k chars)"),
  }),
  func: async ({ path: filename, offset, limit }) => {
    try {
      const fp = resolveWorkspacePath(filename);
      let stat;
      try {
        stat = fs.statSync(fp);
      } catch {
        return `❌ Error: file tidak ditemukan: "${filename}". Cek dengan list_files dulu.`;
      }
      if (!stat.isFile()) return `❌ Error: "${filename}" bukan file.`;
      if (stat.size > MAX_READ_BYTES) {
        return `❌ File "${filename}" ${Math.round(stat.size / 1024)}KB > 100KB. Gunakan search_text dengan context_lines, atau baca per-bagian via offset/limit.`;
      }
      const buf = fs.readFileSync(fp);
      if (isBinary(buf)) {
        return `❌ File "${filename}" terdeteksi biner (${stat.size} bytes). read_file hanya untuk teks.`;
      }
      const content = buf.toString("utf-8");
      if (!content.length) return `📄 File "${filename}" kosong.`;

      // Paging per-baris bila diminta.
      let out = content;
      const totalLines = content.split("\n").length;
      if (offset != null || limit != null) {
        const lines = content.split("\n");
        const start = offset ?? 0;
        const end = limit != null ? start + limit : lines.length;
        if (start >= lines.length) return `❌ offset ${start} di luar total ${lines.length} baris.`;
        out = lines.slice(start, end).join("\n");
        const header = `📄 "${filename}" baris ${start}-${Math.min(end, lines.length) - 1} dari ${lines.length}:\n`;
        if (out.length > MAX_OUTPUT_CHARS) {
          const half = Math.floor(MAX_OUTPUT_CHARS / 2);
          out = `${out.slice(0, half)}\n…[${out.length - MAX_OUTPUT_CHARS} chars dipotong, gunakan offset/limit]…\n${out.slice(-half)}`;
        }
        return `${header}\`\`\`\n${out}\n\`\`\``;
      }

      if (content.length > MAX_OUTPUT_CHARS) {
        const half = Math.floor(MAX_OUTPUT_CHARS / 2);
        out = `${content.slice(0, half)}\n…[${content.length - MAX_OUTPUT_CHARS} chars dipotong — gunakan offset/limit atau search_text]…\n${content.slice(-half)}`;
      }
      return `📄 Isi "${filename}" (${content.length} chars${totalLines ? `, ${totalLines} baris` : ""}):\n\`\`\`\n${out}\n\`\`\``;
    } catch (err) {
      return `❌ Error: ${err.message}`;
    }
  },
});
