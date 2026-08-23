/**
 * tools/session_memory.js
 *
 * Expose core/sessionMemory.js ke LLM — analog MEMORY.md (fakta durable,
 * agent-driven) + session_search milik Hermes Agent. Lihat penjelasan
 * arsitektur lengkap di core/sessionMemory.js.
 *
 * Pola session_id sama seperti group_manager.js/scheduler.js: diterima
 * sebagai parameter schema biasa (BUKAN dari config.configurable, yang
 * selalu undefined karena core/chat.js manggil tool.invoke(args) tanpa
 * config) — LLM mengisi sendiri dari blok [INFO SYSTEM] di system prompt.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import sessionMemory from "../core/sessionMemory.js";

export const sessionMemoryTool = tool(
  async ({ action, session_id, fact, query }) => {
    if (!session_id) {
      return "❌ Parameter session_id wajib diisi (ambil dari blok [INFO SYSTEM] di system prompt).";
    }

    switch (action) {
      case "remember": {
        if (!fact) return "❌ Parameter 'fact' wajib diisi untuk action remember.";
        const result = await sessionMemory.rememberFact(session_id, fact);
        if (result.deduped) return `ℹ️ Fakta itu sudah tersimpan sebelumnya (total ${result.total} fakta di sesi ini).`;
        return `✅ Fakta tersimpan (total ${result.total} fakta di sesi ini).`;
      }

      case "recall": {
        const facts = await sessionMemory.listFacts(session_id);
        if (!facts.length) return "Belum ada fakta tersimpan di sesi ini.";
        return facts.map((f, i) => `${i + 1}. ${f.fact}`).join("\n");
      }

      case "forget": {
        if (!fact) return "❌ Parameter 'fact' wajib diisi (teks fakta PERSIS yang mau dihapus) untuk action forget.";
        const result = await sessionMemory.forgetFact(session_id, fact);
        return result.removed ? "✅ Fakta dihapus." : "⚠️ Gak ketemu fakta dengan teks persis itu — cek dulu pakai action recall.";
      }

      case "search_history": {
        if (!query) return "❌ Parameter 'query' wajib diisi untuk action search_history.";
        const results = await sessionMemory.searchHistory(query, { excludeSessionId: session_id, limit: 5 });
        if (!results.length) return `Gak ketemu apa pun di sesi lain yang cocok dengan "${query}".`;
        return results
          .map((r, i) => `${i + 1}. [Sesi: "${r.title}"] (${r.role}): ${r.excerpt}`)
          .join("\n");
      }

      default:
        return `❌ Action '${action}' tidak dikenal.`;
    }
  },
  {
    name: "session_memory",
    description:
      "Kelola memori durable untuk sesi chat SAAT INI (bukan riwayat mentah biasa yang otomatis kepotong " +
      "setelah beberapa turn) — analog MEMORY.md/session_search di agent modern. Actions:\n" +
      "- remember (butuh 'fact'): simpan 1 fakta yang perlu diingat MELEWATI batas riwayat mentah — preferensi " +
      "user, keputusan yang disepakati, detail konteks kerja. Panggil PROAKTIF begitu user menyebutkan sesuatu " +
      "seperti itu, jangan tunggu diminta.\n" +
      "- recall: lihat semua fakta yang tersimpan di sesi ini.\n" +
      "- forget (butuh 'fact' — teks PERSIS): hapus 1 fakta tersimpan.\n" +
      "- search_history (butuh 'query'): cari lintas SESI LAIN (bukan sesi ini) kalau user menyebut sesuatu " +
      "yang terasa seperti kelanjutan obrolan lama yang gak keliatan di riwayat/fakta sesi ini.",
    schema: z.object({
      action: z.enum(["remember", "recall", "forget", "search_history"]),
      session_id: z.string().describe("Session ID aktif — ambil dari blok [INFO SYSTEM] di system prompt."),
      fact: z.string().optional().describe("Teks fakta (untuk action remember/forget)."),
      query: z.string().optional().describe("Kata kunci pencarian (untuk action search_history)."),
    }),
  }
);

export default sessionMemoryTool;
