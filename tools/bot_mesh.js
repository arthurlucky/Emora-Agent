/**
 * tools/bot_mesh.js
 *
 * LLM Tool untuk Fitur Multi-Bot Agent Mesh & Kolaborasi Perusahaan.
 * Memungkinkan EMORA & Bot untuk saling mendelegasikan tugas, membuat grup bot,
 * serta memanfaatkan tools & skills yang relevan secara mandiri.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import chalk from "chalk";
import { listBots, getBot, registerBot, listGroups, createGroup } from "../core/botRegistry.js";

export const botMeshTool = tool(
  async ({ action, bot_id, group_name, task, name, role, color, tools: botTools }) => {
    try {
      if (action === "list_bots") {
        const bots = await listBots();
        const groups = await listGroups();

        let out = "🤖 **DAFTAR BOT PERUSAHAAN & PECAHAN AGENT:**\n\n";
        for (const b of bots) {
          const colorBadge = chalk.hex(b.color || "#58a6ff")(`[${b.name}]`);
          out += `• **${b.name}** (ID: \`${b.id}\` | Warna: ${b.color})\n`;
          out += `  Peran: ${b.role}\n`;
          out += `  Tools: ${b.tools?.join(", ") || "(semua tool)"}\n\n`;
        }

        if (groups.length > 0) {
          out += "🏢 **GRUP / DEPARTEMEN BOT:**\n";
          for (const g of groups) {
            out += `• **${g.name}** (Leader: \`${g.leaderBotId}\` | Anggota: ${g.botIds.join(", ")})\n`;
            out += `  Deskripsi: ${g.description}\n`;
          }
        }
        return out;
      }

      if (action === "create_bot") {
        if (!name || !role) return "❌ Parameter name dan role wajib diisi untuk membuat bot baru.";
        const newBot = await registerBot({ name, role, color: color || "#58a6ff", tools: botTools || [] });
        return `✅ Bot baru berhasil didaftarkan:\n• Nama: **${newBot.name}** (ID: \`${newBot.id}\`)\n• Warna: ${newBot.color}\n• Peran: ${newBot.role}`;
      }

      if (action === "create_group") {
        if (!group_name) return "❌ Parameter group_name wajib diisi.";
        const bots = await listBots();
        const allBotIds = bots.map(b => b.id);
        const group = await createGroup({ name: group_name, description: role || "Grup Kolaborasi Bot", botIds: allBotIds });
        return `🏢 Grup Bot **${group.name}** berhasil dibuat dengan ${group.botIds.length} anggota bot.`;
      }

      if (action === "delegate_task") {
        if (!bot_id || !task) return "❌ Parameter bot_id dan task wajib diisi untuk mendelegasikan tugas.";
        
        const targetBot = await getBot(bot_id);
        if (!targetBot) return `❌ Bot "${bot_id}" tidak ditemukan. Gunakan action list_bots untuk melihat daftar bot.`;

        // Simulasi / Eksekusi Delegasi Tugas dengan Persona Bot Target
        const colorFn = chalk.hex(targetBot.color || "#58a6ff").bold;
        console.log(colorFn(`\n[🤖 DELEGASI BOT: ${targetBot.name}] Mengambil tugas: "${task.slice(0, 60)}..."`));

        const { createLLM, detectProvider } = await import("../provider/index.js");
        const { HumanMessage, SystemMessage } = await import("@langchain/core/messages");
        
        const llm = await createLLM([], detectProvider());
        
        const systemPrompt = 
          `Kamu adalah ${targetBot.name}, pecahan agent spesialis dengan peran:\n` +
          `"${targetBot.role}"\n\n` +
          `Selesaikan tugas yang diberikan pengguna atau bot lain dengan profesional, ringkas, akurat, dan sesuai peranmu.\n` +
          `Format jawabanmu dengan diawali tag badge nama bot: [🤖 ${targetBot.name}]`;

        const response = await llm.invoke([
          new SystemMessage(systemPrompt),
          new HumanMessage(task),
        ]);

        return (
          `───────────────\n` +
          `🤖 **HASIL DELEGASI BOT [${targetBot.name}]** (Peran: ${targetBot.role})\n` +
          `───────────────\n\n` +
          `${response.content}\n`
        );
      }

      return "❌ Action tidak dikenal. Pilihan: list_bots | create_bot | create_group | delegate_task";
    } catch (e) {
      return `❌ Gagal memproses Bot Mesh: ${e.message}`;
    }
  },
  {
    name: "bot_mesh",
    description:
      "Kelola & delegasikan tugas ke Bot Perusahaan (pecahan agent spesialis). " +
      "Bot memiliki nama, peran, dan warna tersendiri. Bot dapat saling menugaskan task dan berkolaborasi dalam grup.",
    schema: z.object({
      action: z.enum(["list_bots", "create_bot", "create_group", "delegate_task"]).describe("Tindakan bot mesh yang mau dijalankan."),
      bot_id: z.string().optional().describe("ID atau nama bot target untuk delegate_task (mis. devbot, qabot, researchbot)."),
      group_name: z.string().optional().describe("Nama grup/departemen bot yang mau dibuat untuk create_group."),
      task: z.string().optional().describe("Deskripsi tugas yang mau didelegasikan ke bot target."),
      name: z.string().optional().describe("Nama bot baru untuk create_bot."),
      role: z.string().optional().describe("Peran / system prompt spesialis untuk bot baru."),
      color: z.string().optional().describe("Kode warna hex untuk bot baru (mis. #58a6ff, #3fb950, #f85149)."),
      tools: z.array(z.string()).optional().describe("Daftar tools yang diizinkan untuk bot baru."),
    }),
  }
);

export default botMeshTool;
