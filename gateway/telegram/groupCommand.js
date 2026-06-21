/**
 * gateway/telegram/groupCommand.js
 *
 * Tool handler buat perintah manajemen grup Telegram. Sengaja dibikin
 * dengan pola & signature yang SAMA PERSIS kayak sendfile.js
 * (`handle___(command, sessionId)` dengan command berupa raw string),
 * biar gampang disambungin ke mekanisme yang udah ada di core/tools.js
 * buat wiring "sendFile".
 *
 * Resolve chatId dari sessionId lewat reverse-lookup `sessions` map
 * (1 sesi = 1 chat di Telegram, baik grup maupun personal).
 *
 * Format perintah:
 *   groupStatus
 *   groupListAdmins
 *   groupListMembers
 *   groupKick --userId="123456789"
 *   groupPromote --userId="123456789"
 *   groupDemote --userId="123456789"
 *   groupDeleteMessage --messageId="456"
 *   groupInviteLink
 */

import {
  listAdmins,
  listMembers,
  kickMember,
  promoteAdmin,
  demoteAdmin,
  deleteMessage,
  generateInviteLink,
  getMemberStatus,
} from "./groupManager.js";
import { getContext } from "../sessionContext.js";

function parseArg(command, name) {
  const match = command.match(new RegExp(`--${name}=["']?([^"'\\s]+)["']?`));
  return match ? match[1] : null;
}

/**
 * @param {string} command   - Raw command string (mis. `groupKick --userId="123"`)
 * @param {string} sessionId - Session ID user yang aktif
 * @returns {Promise<string>}
 */
export async function handleGroupCommand(command, sessionId) {
  try {
    const { bot, sessions } = await import("./telegram.js");
    if (!bot) return "❌ Telegram gateway tidak aktif.";

    const chatId = Object.keys(sessions).find((k) => sessions[k] === sessionId);
    if (!chatId) return "❌ Sesi Telegram tidak ditemukan. User belum memulai chat.";

    const ctx = getContext(sessionId);
    if (!ctx || ctx.chatType !== "group") {
      return "❌ Perintah ini cuma berlaku di grup, bukan chat personal.";
    }

    const action = command.trim().split(/\s+/)[0];

    switch (action) {
      case "groupStatus": {
        const botStatus = await getMemberStatus(bot.telegram, chatId, bot.botInfo?.id, { force: true });
        return (
          `📋 *Status Grup*\n` +
          `Nama: ${ctx.chatTitle || "(tanpa nama)"}\n` +
          `Status bot: ${botStatus.isAdmin ? "✅ Admin" : "👤 Member biasa"}\n` +
          `Pengirim (${ctx.senderName}): ${ctx.senderIsAdmin ? "✅ Admin" : "👤 Member biasa"}`
        );
      }

      case "groupListAdmins": {
        const admins = await listAdmins(bot.telegram, chatId);
        if (!admins.length) return "Tidak ada admin terdeteksi.";
        return `👑 *Daftar Admin*\n` + admins.map((a) => `- ${a.label}${a.isOwner ? " (owner)" : ""}`).join("\n");
      }

      case "groupListMembers": {
        const result = await listMembers(bot.telegram, chatId);
        const adminLines = result.admins.map((a) => `- ${a.label}${a.isOwner ? " (owner)" : ""}`).join("\n");
        return (
          `👥 *Info Member*\nTotal member: ${result.totalCount ?? "?"}\n\n` +
          `Admin:\n${adminLines || "(tidak ada)"}\n\n_${result.note}_`
        );
      }

      case "groupKick": {
        const userId = parseArg(command, "userId");
        if (!userId) return '❌ Format salah. Gunakan: groupKick --userId="123456789"';
        const botStatus = await getMemberStatus(bot.telegram, chatId, bot.botInfo?.id, { force: true });
        if (!botStatus.isAdmin) return "❌ Bot bukan admin di grup ini, gak bisa kick member.";
        await kickMember(bot.telegram, chatId, userId);
        return `✅ User id:${userId} berhasil dikeluarkan dari grup.`;
      }

      case "groupPromote": {
        const userId = parseArg(command, "userId");
        if (!userId) return '❌ Format salah. Gunakan: groupPromote --userId="123456789"';
        const botStatus = await getMemberStatus(bot.telegram, chatId, bot.botInfo?.id, { force: true });
        if (!botStatus.isAdmin) return "❌ Bot bukan admin di grup ini, gak bisa mengangkat admin.";
        await promoteAdmin(bot.telegram, chatId, userId);
        return `✅ User id:${userId} sekarang jadi admin.`;
      }

      case "groupDemote": {
        const userId = parseArg(command, "userId");
        if (!userId) return '❌ Format salah. Gunakan: groupDemote --userId="123456789"';
        const botStatus = await getMemberStatus(bot.telegram, chatId, bot.botInfo?.id, { force: true });
        if (!botStatus.isAdmin) return "❌ Bot bukan admin di grup ini, gak bisa menurunkan admin.";
        await demoteAdmin(bot.telegram, chatId, userId);
        return `✅ Status admin user id:${userId} sudah dicabut.`;
      }

      case "groupDeleteMessage": {
        const messageId = parseArg(command, "messageId");
        if (!messageId) return '❌ Format salah. Gunakan: groupDeleteMessage --messageId="456"';
        const botStatus = await getMemberStatus(bot.telegram, chatId, bot.botInfo?.id, { force: true });
        if (!botStatus.isAdmin) return "❌ Bot bukan admin di grup ini, gak bisa hapus pesan.";
        await deleteMessage(bot.telegram, chatId, Number(messageId));
        return `✅ Pesan id:${messageId} berhasil dihapus.`;
      }

      case "groupInviteLink": {
        const botStatus = await getMemberStatus(bot.telegram, chatId, bot.botInfo?.id, { force: true });
        if (!botStatus.isAdmin) return "❌ Bot bukan admin di grup ini, gak bisa generate invite link.";
        const link = await generateInviteLink(bot.telegram, chatId);
        return `🔗 Invite link grup: ${link}\n\n_(Bot Telegram gak bisa nambah member langsung — share link ini ke orang yang mau diundang.)_`;
      }

      default:
        return (
          "❌ Perintah grup tidak dikenal. Gunakan salah satu: groupStatus, groupListAdmins, " +
          "groupListMembers, groupKick, groupPromote, groupDemote, groupDeleteMessage, groupInviteLink."
        );
    }
  } catch (err) {
    return `❌ Error perintah grup Telegram: ${err.message}`;
  }
}
