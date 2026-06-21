/**
 * gateway/whatsapp/groupManager.js
 *
 * Fungsi-fungsi manajemen grup WhatsApp lewat Baileys.
 *
 * Beda dengan Telegram Bot API, koneksi Baileys jalan sebagai akun WA biasa
 * (bukan "bot" resmi) — jadi API-nya lebih leluasa: bisa nambah member
 * langsung, lihat semua participant, dll. TAPI itu juga berarti aksi-aksi
 * ini dijalankan atas nama akun WhatsApp yang dipakai EMORA, dan WhatsApp
 * bisa membatasi/banned akun yang dianggap melakukan otomasi grup secara
 * agresif (terutama add member berulang ke banyak grup berbeda). Pakai
 * secukupnya, jangan dipakai buat spam-add.
 *
 * Semua aksi moderasi (kick/add/promote/demote/delete) cuma akan berhasil
 * kalau akun EMORA berstatus admin di grup tersebut.
 */

import { jidNormalizedUser } from "@whiskeysockets/baileys";

const metadataCache = new Map(); // groupId -> { data, expiresAt }
const CACHE_TTL_MS = 60 * 1000; // 1 menit

export async function getGroupMetadata(client, groupId, { force = false } = {}) {
  const cached = metadataCache.get(groupId);
  if (!force && cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  const data = await client.groupMetadata(groupId);
  metadataCache.set(groupId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export function invalidateGroupCache(groupId) {
  metadataCache.delete(groupId);
}

function normalizeJid(jid) {
  if (!jid) return jid;
  try {
    return jidNormalizedUser(jid);
  } catch {
    return jid;
  }
}

export function getBotJid(client) {
  return client?.user?.id ? normalizeJid(client.user.id) : null;
}

export function findParticipant(metadata, jid) {
  const target = normalizeJid(jid);
  return metadata.participants.find((p) => normalizeJid(p.id) === target) || null;
}

export function isParticipantAdmin(participant) {
  return participant?.admin === "admin" || participant?.admin === "superadmin";
}

export async function getBotStatus(client, groupId) {
  const metadata = await getGroupMetadata(client, groupId, { force: true });
  const botJid = getBotJid(client);
  const participant = botJid ? findParticipant(metadata, botJid) : null;
  return { isAdmin: isParticipantAdmin(participant), participant, groupName: metadata.subject };
}

export async function getMemberStatus(client, groupId, userJid) {
  const metadata = await getGroupMetadata(client, groupId);
  const participant = findParticipant(metadata, userJid);
  return { isAdmin: isParticipantAdmin(participant), participant };
}

function formatParticipantLabel(p) {
  const number = (p.id || "").split("@")[0];
  return p.notify || p.name ? `${p.notify || p.name} (${number})` : number;
}

export async function listMembers(client, groupId) {
  const metadata = await getGroupMetadata(client, groupId, { force: true });
  return metadata.participants.map((p) => ({
    id: p.id,
    label: formatParticipantLabel(p),
    isAdmin: isParticipantAdmin(p),
    role: p.admin === "superadmin" ? "superadmin" : p.admin === "admin" ? "admin" : "member",
  }));
}

export async function listAdmins(client, groupId) {
  const members = await listMembers(client, groupId);
  return members.filter((m) => m.isAdmin);
}

export async function kickMember(client, groupId, userJid) {
  const result = await client.groupParticipantsUpdate(groupId, [userJid], "remove");
  invalidateGroupCache(groupId);
  return result;
}

export async function addMember(client, groupId, userJid) {
  const result = await client.groupParticipantsUpdate(groupId, [userJid], "add");
  invalidateGroupCache(groupId);
  return result;
}

export async function promoteAdmin(client, groupId, userJid) {
  const result = await client.groupParticipantsUpdate(groupId, [userJid], "promote");
  invalidateGroupCache(groupId);
  return result;
}

export async function demoteAdmin(client, groupId, userJid) {
  const result = await client.groupParticipantsUpdate(groupId, [userJid], "demote");
  invalidateGroupCache(groupId);
  return result;
}

/**
 * Hapus pesan (revoke "for everyone"). Butuh `messageKey` lengkap:
 * { remoteJid, id, participant?, fromMe }. Kalau bukan pesan milik bot
 * sendiri, butuh status admin di grup tsb biar bisa hapus punya orang lain.
 */
export async function deleteMessage(client, groupId, messageKey) {
  return client.sendMessage(groupId, { delete: messageKey });
}
