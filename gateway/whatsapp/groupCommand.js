/**
 * gateway/whatsapp/groupCommand.js
 *
 * Tool handler buat perintah manajemen grup WhatsApp. Pola & signature
 * sama persis kayak sendfile.js (`handle___(command, sessionId)`).
 *
 * Resolve groupId dari sessionId lewat sessionContext (BUKAN dari
 * `sessions` map biasa — soalnya sesi WhatsApp di-key per nomor pengirim,
 * bukan per chat. Lihat catatan lengkap di sessionContext.js).
 *
 * Format perintah:
 *   groupStatus
 *   groupListAdmins
 *   groupListMembers
 *   groupKick --userId="628xxxxxxxxxx"
 *   groupAdd --userId="628xxxxxxxxxx"
 *   groupPromote --userId="628xxxxxxxxxx"
 *   groupDemote --userId="628xxxxxxxxxx"
 *   groupDeleteMessage   (hapus pesan terakhir yang di-reply user)
 */

import {
  listAdmins,
  listMembers,
  kickMember,
  addMember,
  promoteAdmin,
  demoteAdmin,
  deleteMessage,
  getBotStatus,
} from "./groupManager.js";
import { getContext } from "../sessionContext.js";

function parseArg(command, name) {
  const match = command.match(new RegExp(`--${name}=["']?([^"'\\s]+)["']?`));
  return match ? match[1] : null;
}

function toJid(rawNumber) {
  const value = String(rawNumber);
  if (value.includes("@")) return value;
  return `${value.replace(/\D/g, "")}@s.whatsapp.net`;
}

/**
 * @param {string} command   - Raw command string (mis. `groupKick --userId="628xxx"`)
 * @param {string} sessionId - Session ID user yang aktif
 * @returns {Promise<string>}
 */
export async function handleGroupCommand(command, sessionId) {
  try {
    const { client } = await import("./whatsapp.js");
    if (!client) return "❌ WhatsApp gateway tidak aktif.";

    const ctx = getContext(sessionId);
    if (!ctx || ctx.chatType !== "group") {
      return "❌ Perintah ini cuma berlaku di grup, bukan chat personal.";
    }

    const groupId = ctx.chatId;
    const action = command.trim().split(/\s+/)[0];

    switch (action) {
      case "groupStatus": {
        const botStatus = await getBotStatus(client, groupId);
        return (
          `📋 *Status Grup*\n` +
          `Nama: ${botStatus.groupName || ctx.chatTitle || "(tanpa nama)"}\n` +
          `Status EMORA: ${botStatus.isAdmin ? "✅ Admin" : "👤 Member biasa"}\n` +
          `Pengirim (${ctx.senderName}): ${ctx.senderIsAdmin ? "✅ Admin" : "👤 Member biasa"}`
        );
      }

      case "groupListAdmins": {
        const admins = await listAdmins(client, groupId);
        if (!admins.length) return "Tidak ada admin terdeteksi.";
        return (
          `👑 *Daftar Admin*\n` +
          admins.map((a) => `- ${a.label}${a.role === "superadmin" ? " (owner)" : ""}`).join("\n")
        );
      }

      case "groupListMembers": {
        const members = await listMembers(client, groupId);
        return (
          `👥 *Daftar Member* (${members.length})\n` +
          members.map((m) => `- ${m.label}${m.isAdmin ? ` [${m.role}]` : ""}`).join("\n")
        );
      }

      case "groupKick": {
        const userId = parseArg(command, "userId");
        if (!userId) return '❌ Format salah. Gunakan: groupKick --userId="628xxxxxxxxxx"';
        const botStatus = await getBotStatus(client, groupId);
        if (!botStatus.isAdmin) return "❌ EMORA bukan admin di grup ini, gak bisa kick member.";
        await kickMember(client, groupId, toJid(userId));
        return `✅ ${userId} berhasil dikeluarkan dari grup.`;
      }

      case "groupAdd": {
        const userId = parseArg(command, "userId");
        if (!userId) return '❌ Format salah. Gunakan: groupAdd --userId="628xxxxxxxxxx"';
        const botStatus = await getBotStatus(client, groupId);
        if (!botStatus.isAdmin) return "❌ EMORA bukan admin di grup ini, gak bisa menambah member.";
        const result = await addMember(client, groupId, toJid(userId));
        const status = result?.[0]?.status;
        if (status === "200") return `✅ ${userId} berhasil ditambahkan ke grup.`;
        return (
          `⚠️ Gagal menambahkan ${userId} (status: ${status}). Kemungkinan nomor itu membatasi ` +
          `siapa yang bisa menambahkannya ke grup — coba minta dia join lewat link undangan.`
        );
      }

      case "groupPromote": {
        const userId = parseArg(command, "userId");
        if (!userId) return '❌ Format salah. Gunakan: groupPromote --userId="628xxxxxxxxxx"';
        const botStatus = await getBotStatus(client, groupId);
        if (!botStatus.isAdmin) return "❌ EMORA bukan admin di grup ini, gak bisa mengangkat admin.";
        await promoteAdmin(client, groupId, toJid(userId));
        return `✅ ${userId} sekarang jadi admin.`;
      }

      case "groupDemote": {
        const userId = parseArg(command, "userId");
        if (!userId) return '❌ Format salah. Gunakan: groupDemote --userId="628xxxxxxxxxx"';
        const botStatus = await getBotStatus(client, groupId);
        if (!botStatus.isAdmin) return "❌ EMORA bukan admin di grup ini, gak bisa menurunkan admin.";
        await demoteAdmin(client, groupId, toJid(userId));
        return `✅ Status admin ${userId} sudah dicabut.`;
      }

      case "groupDeleteMessage": {
        if (!ctx.replyToMessage) {
          return "❌ Gak ada pesan yang sedang di-reply. Minta user reply pesan yang mau dihapus dulu.";
        }
        const botStatus = await getBotStatus(client, groupId);
        const isOwnMessage = !ctx.replyToMessage.participant;
        if (!botStatus.isAdmin && !isOwnMessage) {
          return "❌ EMORA bukan admin di grup ini, cuma bisa hapus pesannya sendiri.";
        }
        await deleteMessage(client, groupId, {
          remoteJid: groupId,
          id: ctx.replyToMessage.id,
          participant: ctx.replyToMessage.participant || undefined,
          fromMe: isOwnMessage,
        });
        return "✅ Pesan berhasil dihapus.";
      }

      default:
        return (
          "❌ Perintah grup tidak dikenal. Gunakan salah satu: groupStatus, groupListAdmins, " +
          "groupListMembers, groupKick, groupAdd, groupPromote, groupDemote, groupDeleteMessage."
        );
    }
  } catch (err) {
    return `❌ Error perintah grup WhatsApp: ${err.message}`;
  }
}
