/**
 * tools/artifact_tool.js
 * Tool agar AI agent bisa membuat & mengelola Artifact (dokumen/kode/config
 * terstruktur yang tersimpan persisten, terpisah dari riwayat chat biasa)
 * langsung selama percakapan.
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import artifactManager from "../core/artifactManager.js";

export const artifactTool = new DynamicStructuredTool({
  name: "artifact",
  description:
    "Buat, lihat, ubah, atau hapus Artifact — dokumen/kode/konfigurasi terstruktur yang " +
    "disimpan persisten (punya versioning), cocok untuk output yang akan dipakai/diedit " +
    "ulang nanti (laporan, kode, config, diagram mermaid, dst), bukan untuk jawaban singkat biasa.",
  schema: z.object({
    action: z.enum(["create", "list", "get", "update", "delete", "history"]).describe(
      "'create' = buat artifact baru. 'list' = daftar semua artifact. 'get' = ambil isi 1 artifact. " +
      "'update' = ubah isi artifact (nambah versi baru). 'delete' = hapus artifact. " +
      "'history' = lihat riwayat versi 1 artifact."
    ),
    id: z.string().optional().describe("ID artifact (wajib untuk get/update/delete/history)."),
    name: z.string().optional().describe("Nama artifact (wajib untuk create)."),
    type: z.enum(artifactManager.ARTIFACT_TYPES).optional().describe("Tipe artifact (default: markdown)."),
    content: z.string().optional().describe("Isi konten artifact (wajib untuk create/update)."),
    summary: z.string().optional().describe("Ringkasan perubahan (untuk update, opsional)."),
  }),
  func: async ({ action, id, name, type, content, summary }) => {
    try {
      switch (action) {
        case "create": {
          if (!name || content === undefined) return "❌ 'name' dan 'content' wajib diisi untuk membuat artifact.";
          const artifact = artifactManager.createArtifact({ name, type, content });
          return `✅ Artifact dibuat.\nID: ${artifact.id}\nNama: ${artifact.name}\nTipe: ${artifact.type}\nVersi: ${artifact.version}`;
        }
        case "list": {
          const list = artifactManager.listArtifacts();
          if (list.length === 0) return "📭 Belum ada artifact.";
          return list.map((a) => `• [${a.id}] ${a.name} (${a.type}, v${a.version})`).join("\n");
        }
        case "get": {
          if (!id) return "❌ 'id' wajib diisi.";
          const artifact = artifactManager.getArtifact(id);
          return `📄 ${artifact.name} (${artifact.type}, v${artifact.version})\n\n${artifact.content}`;
        }
        case "update": {
          if (!id || content === undefined) return "❌ 'id' dan 'content' wajib diisi untuk update.";
          const artifact = artifactManager.updateArtifact(id, content, summary);
          return `✅ Artifact diperbarui ke v${artifact.version}.`;
        }
        case "delete": {
          if (!id) return "❌ 'id' wajib diisi.";
          artifactManager.deleteArtifact(id);
          return `✅ Artifact ${id} dihapus.`;
        }
        case "history": {
          if (!id) return "❌ 'id' wajib diisi.";
          const history = artifactManager.getArtifactHistory(id);
          return history.map((h) => `v${h.version} — ${h.summary} (${new Date(h.createdAt).toLocaleString()})`).join("\n");
        }
        default:
          return `❌ Action "${action}" tidak dikenal.`;
      }
    } catch (err) {
      return `❌ Error: ${err.message}`;
    }
  },
});

export default artifactTool;
