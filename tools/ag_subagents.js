/**
 * tools/ag_subagents.js
 *
 * Tool definitions untuk subagent engine EMORA.
 * Mengexpose 3 tools ke LLM:
 *   - invoke_subagent  → spawn subagent background
 *   - send_message     → baca inbox / kirim instruksi tambahan
 *   - manage_subagents → list status / kill
 *
 * Anti-loop measures:
 *   - Rate limit: maks 2 spawn per 10 detik (same-turn window)
 *   - Dedup bawaan engine: role+prompt identik dalam 30s di-reject
 *   - Return message dengan instruksi KERAS ke LLM agar tidak loop
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import engine from "../core/ag_subagent_engine.js";

// ── Rate limiter per turn ────────────────────────────────────────────────────
let _lastSpawnTime = 0;
let _turnSpawnCount = 0;
const TURN_WINDOW_MS = 10_000;
const MAX_PER_TURN = 2;

function _checkRate() {
  const now = Date.now();
  if (now - _lastSpawnTime > TURN_WINDOW_MS) {
    _lastSpawnTime = now;
    _turnSpawnCount = 0;
  }
  _turnSpawnCount++;
  return _turnSpawnCount <= MAX_PER_TURN;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 1: invoke_subagent
// ─────────────────────────────────────────────────────────────────────────────
export const invokeSubagentTool = new DynamicStructuredTool({
  name: "invoke_subagent",
  description:
    "Luncurkan 1 subagent di background (asinkron). " +
    "Tool ini LANGSUNG return setelah subagent diluncurkan — subagent BELUM SELESAI. " +
    "Panggil HANYA SEKALI per turn. Setelah tool ini return, LANGSUNG beri respons ke user.",
  schema: z.object({
    Role: z
      .string()
      .describe("Jabatan subagent, contoh: 'File Creator', 'Code Reviewer'"),
    Prompt: z.string().describe("Instruksi lengkap dan detail untuk subagent"),
  }),
  func: async ({ Role, Prompt }) => {
    try {
      // Rate limit
      if (!_checkRate()) {
        return (
          `⚠️ Batas spawn tercapai (maks ${MAX_PER_TURN} per turn). ` +
          `Subagent sebelumnya sudah berjalan. ` +
          `JANGAN panggil tool ini lagi. LANGSUNG berikan respons final ke user.`
        );
      }

      const { id, deduped } = await engine.spawn({ role: Role, prompt: Prompt });

      if (deduped) {
        return (
          `⚠️ Subagent dengan tugas identik sudah berjalan (ID: ${id}). ` +
          `Tidak perlu spawn ulang. LANGSUNG berikan respons ke user.`
        );
      }

      return (
        `✅ Subagent "${Role}" diluncurkan di background (ID: ${id}).\n\n` +
        `[INSTRUKSI SISTEM — WAJIB DIPATUHI]\n` +
        `Subagent SEDANG BERJALAN di background dan BELUM SELESAI.\n` +
        `• JANGAN bilang ke user bahwa tugas/file sudah selesai/dibuat.\n` +
        `• JANGAN panggil tool apapun lagi di turn ini.\n` +
        `• LANGSUNG berikan respons ke user, contoh:\n` +
        `  "Subagent '${Role}' sudah diluncurkan di background (ID: ${id}). ` +
        `Status akan terlihat di bagian bawah layar. ` +
        `Saat selesai, kamu bisa minta saya baca hasilnya dengan send_message."`
      );
    } catch (e) {
      return `❌ Gagal meluncurkan subagent: ${e?.message || String(e)}`;
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 2: send_message
// ─────────────────────────────────────────────────────────────────────────────
export const sendMessageTool = new DynamicStructuredTool({
  name: "send_message",
  description:
    "Baca pesan dari inbox subagent, atau kirim instruksi tambahan ke subagent yang idle/done.",
  schema: z.object({
    Recipient: z
      .string()
      .describe("ID subagent target (8 karakter hex, contoh: 'a1b2c3d4')"),
    Message: z
      .string()
      .optional()
      .describe(
        "Instruksi tambahan untuk subagent. Kosongkan jika hanya ingin membaca inbox."
      ),
  }),
  func: async ({ Recipient, Message }) => {
    try {
      let output = "";

      // Kirim pesan jika ada
      if (Message && Message.trim()) {
        try {
          engine.sendMessage(Recipient, Message);
          output += `✅ Instruksi dikirim ke subagent ${Recipient}. Dia kembali bekerja di background.\n`;
        } catch (sendErr) {
          output += `❌ Gagal mengirim: ${sendErr?.message || String(sendErr)}\n`;
        }
      }

      // Baca inbox
      const msgs = engine.readInbox(Recipient);
      if (msgs.length > 0) {
        output += `\n📥 INBOX DARI SUBAGENT ${Recipient}:\n${"─".repeat(50)}\n`;
        output += msgs.join("\n\n---\n\n");
        output += `\n${"─".repeat(50)}`;
      } else if (!Message || !Message.trim()) {
        output += `(Belum ada pesan baru dari subagent ${Recipient}. Mungkin masih bekerja.)`;
      }

      return output.trim();
    } catch (e) {
      return `❌ ${e?.message || String(e)}`;
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// TOOL 3: manage_subagents
// ─────────────────────────────────────────────────────────────────────────────
export const manageSubagentsTool = new DynamicStructuredTool({
  name: "manage_subagents",
  description: "Lihat daftar subagent aktif beserta statusnya, atau hentikan subagent.",
  schema: z.object({
    Action: z
      .enum(["list", "kill", "kill_all"])
      .describe("Aksi: list (lihat semua), kill (hentikan satu), kill_all (hentikan semua)"),
    Id: z
      .string()
      .optional()
      .describe("ID subagent untuk kill (wajib jika action = kill)"),
  }),
  func: async ({ Action, Id }) => {
    try {
      if (Action === "list") {
        const list = engine.list();
        if (!list.length) return "Tidak ada subagent aktif.";

        const STATUS_ICON = {
          running: "🟢 running",
          done: "✅ done",
          error: "❌ error",
          killed: "💀 killed",
          timeout: "⏰ timeout",
        };

        return list
          .map((a) => {
            const icon = STATUS_ICON[a.status] || a.status;
            const parts = [`[${a.id}] ${a.role} — ${icon} · ${a.elapsed}s`];
            if (a.unread) parts.push(`📩 ${a.unread} pesan inbox`);
            if (a.toolsUsed.length) parts.push(`Tools: ${a.toolsUsed.join(", ")}`);
            if (a.error) parts.push(`Error: ${a.error}`);
            return parts.join("\n  ");
          })
          .join("\n\n");
      }

      if (Action === "kill") {
        if (!Id) return "❌ Parameter Id wajib diisi untuk action kill.";
        return engine.kill(Id)
          ? `✅ Subagent ${Id} berhasil dihentikan.`
          : `❌ Subagent ${Id} tidak ditemukan.`;
      }

      if (Action === "kill_all") {
        const count = engine.killAll();
        return `✅ ${count} subagent dihentikan.`;
      }

      return "❌ Action tidak dikenal.";
    } catch (e) {
      return `❌ ${e?.message || String(e)}`;
    }
  },
});
