import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { handleGroupCommand } from "../gateway/index.js";

export const groupManagerTool = tool(
  async ({ action, userId, messageId }, config) => {
    // 👉 Sesuaikan baris ini kalau cara nge-thread sessionId ke tool di
    //    project lo beda (mis. lewat closure per-session, bukan RunnableConfig).
    const sessionId = config?.configurable?.sessionId;

    if (!sessionId) {
      return "❌ sessionId tidak tersedia di context tool ini — cek cara core/chat.js manggil tool.";
    }

    const args = (userId ? ` --userId="${userId}"` : "") + (messageId ? ` --messageId="${messageId}"` : "");

    return handleGroupCommand(sessionId, `${action}${args}`);
  },
  {
    name: "group_manager",
    description:
      "Kelola grup Telegram/WhatsApp tempat user SEDANG chat saat ini (bukan grup lain). " +
      "Action yang didukung:\n" +
      "- groupStatus: cek apakah EMORA dan/atau pengirim pesan adalah admin grup ini.\n" +
      "- groupListAdmins: daftar admin grup.\n" +
      "- groupListMembers: daftar member (di Telegram cuma admin + total count, " +
      "Bot API gak izinkan list semua member; di WhatsApp daftar lengkap).\n" +
      "- groupKick (butuh userId): keluarkan member dari grup.\n" +
      "- groupAdd (butuh userId, KHUSUS WhatsApp): tambah member ke grup.\n" +
      "- groupPromote (butuh userId): angkat member jadi admin.\n" +
      "- groupDemote (butuh userId): turunkan admin jadi member biasa.\n" +
      "- groupDeleteMessage (Telegram butuh messageId; WhatsApp butuh user me-reply pesan yang mau dihapus): hapus pesan.\n" +
      "- groupInviteLink (KHUSUS Telegram): generate link undangan grup (pengganti add member, karena bot Telegram gak bisa nambah member langsung).\n" +
      "Semua action ini cuma berlaku di chat grup, gak bisa dipakai di chat personal. " +
      "Semua action moderasi (kick/promote/demote/delete/add) butuh EMORA berstatus admin di grup tsb.",
    schema: z.object({
      action: z.enum([
        "groupStatus",
        "groupListAdmins",
        "groupListMembers",
        "groupKick",
        "groupAdd",
        "groupPromote",
        "groupDemote",
        "groupDeleteMessage",
        "groupInviteLink",
      ]),
      userId: z
        .string()
        .optional()
        .describe("ID (Telegram) atau nomor (WhatsApp) user target. Wajib untuk groupKick/groupAdd/groupPromote/groupDemote."),
      messageId: z.string().optional().describe("ID pesan yang mau dihapus. Cuma dipakai di Telegram untuk groupDeleteMessage."),
    }),
  }
);

export default groupManagerTool;