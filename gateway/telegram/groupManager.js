/**
 * gateway/telegram/groupManager.js
 *
 * Fungsi-fungsi manajemen grup Telegram lewat Bot API (via Telegraf).
 *
 * KETERBATASAN BOT API TELEGRAM (penting, baca dulu sebelum pakai):
 *  - Bot TIDAK BISA menambahkan member ke grup secara langsung — itu
 *    kebijakan privasi Telegram, cuma bisa dilakukan akun user asli
 *    (client API/MTProto), bukan lewat Bot API. Yang bisa dilakukan bot:
 *    generate invite link buat di-share manual. Lihat `generateInviteLink()`.
 *  - Bot TIDAK BISA mengambil daftar SEMUA member grup (dibatasi
 *    privasi/skala oleh Telegram). Yang tersedia cuma daftar admin
 *    (`getChatAdministrators`) dan cek status user tertentu kalau user ID
 *    -nya sudah diketahui (`getChatMember`). `listMembers()` di bawah
 *    karena itu fallback ke daftar admin + jumlah total member, BUKAN
 *    daftar lengkap semua orang.
 *  - Semua aksi moderasi (kick, promote, demote, delete message) cuma
 *    jalan kalau BOT sendiri berstatus admin di grup tsb dengan hak akses
 *    yang sesuai (diatur Telegram pas bot dipromosikan jadi admin manual
 *    oleh owner grup).
 */

const memberStatusCache = new Map(); // `${chatId}:${userId}` -> { data, expiresAt }
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 menit — cukup buat ngirit call API tanpa basi

export async function getChatMemberCached(telegram, chatId, userId, { force = false } = {}) {
  const key = `${chatId}:${userId}`;
  const cached = memberStatusCache.get(key);
  if (!force && cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const data = await telegram.getChatMember(chatId, userId);
    memberStatusCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch {
    // User mungkin sudah keluar grup, atau bot belum jadi member di chat
    // ini — biarkan pemanggil yang menentukan fallback (status "unknown").
    return null;
  }
}

export function isAdminStatus(member) {
  return member?.status === "administrator" || member?.status === "creator";
}

export function formatMemberLabel(member) {
  if (!member?.user) return "Tidak diketahui";
  const u = member.user;
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || "(tanpa nama)";
  const username = u.username ? ` (@${u.username})` : "";
  return `${name}${username} — id:${u.id}`;
}

export async function getMemberStatus(telegram, chatId, userId, opts) {
  const member = await getChatMemberCached(telegram, chatId, userId, opts);
  return { status: member?.status || "unknown", isAdmin: isAdminStatus(member), raw: member };
}

/** Daftar admin grup — satu-satunya "daftar member" yang Bot API izinkan. */
export async function listAdmins(telegram, chatId) {
  const admins = await telegram.getChatAdministrators(chatId);
  return admins.map((m) => ({
    id: m.user.id,
    label: formatMemberLabel(m),
    status: m.status, // "creator" | "administrator"
    isOwner: m.status === "creator",
  }));
}

/**
 * "List member" — keterbatasan Bot API bikin ini gak bisa daftar lengkap
 * semua orang di grup. Balikin admin list + total count sebagai gantinya,
 * dengan catatan jelas biar agent gak salah ngira datanya lengkap.
 */
export async function listMembers(telegram, chatId) {
  const [admins, count] = await Promise.all([
    listAdmins(telegram, chatId),
    telegram.getChatMembersCount(chatId).catch(() => null),
  ]);
  return {
    totalCount: count,
    admins,
    note:
      "Telegram Bot API tidak mengizinkan bot mengambil daftar lengkap semua member " +
      "(hanya admin yang bisa di-list). Untuk cek member non-admin tertentu, butuh " +
      "user ID atau username-nya secara eksplisit.",
  };
}

/** "Kick" (bukan ban permanen): ban lalu langsung unban, jadi user dikeluarkan tapi tetap bisa join lagi lewat invite link baru. */
export async function kickMember(telegram, chatId, userId) {
  await telegram.banChatMember(chatId, userId);
  await telegram.unbanChatMember(chatId, userId, { only_if_banned: true });
  memberStatusCache.delete(`${chatId}:${userId}`);
}

export async function promoteAdmin(telegram, chatId, userId) {
  // Hak moderator standar — sengaja TIDAK kasih can_promote_members biar
  // admin baru gak bisa mengangkat admin lain (cegah eskalasi berantai).
  await telegram.promoteChatMember(chatId, userId, {
    can_change_info: false,
    can_delete_messages: true,
    can_invite_users: true,
    can_restrict_members: true,
    can_pin_messages: true,
    can_promote_members: false,
    can_manage_chat: true,
    can_manage_video_chats: false,
  });
  memberStatusCache.delete(`${chatId}:${userId}`);
}

export async function demoteAdmin(telegram, chatId, userId) {
  await telegram.promoteChatMember(chatId, userId, {
    can_change_info: false,
    can_delete_messages: false,
    can_invite_users: false,
    can_restrict_members: false,
    can_pin_messages: false,
    can_promote_members: false,
    can_manage_chat: false,
    can_manage_video_chats: false,
  });
  memberStatusCache.delete(`${chatId}:${userId}`);
}

export async function deleteMessage(telegram, chatId, messageId) {
  await telegram.deleteMessage(chatId, messageId);
}

/** Pengganti "add member" — bot gak bisa nambah langsung, jadi generate link undangan buat di-share manual. */
export async function generateInviteLink(telegram, chatId) {
  return telegram.exportChatInviteLink(chatId);
}
