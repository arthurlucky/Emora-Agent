/**
 * gateway/sessionContext.js
 *
 * Penyimpanan in-memory "konteks pesan terakhir" per sessionId, lintas
 * platform (Telegram & WhatsApp). Dipakai untuk dua hal:
 *
 *  1. Memberi tahu agent (lewat header singkat yang disisipkan di depan
 *     tiap pesan) lagi ngobrol di platform apa, di grup atau chat personal,
 *     dan apakah dia (bot) atau si pengirim admin grup atau bukan.
 *  2. Jadi sumber kebenaran buat tool group-management (kick/promote/dst):
 *     karena tool cuma menerima `sessionId` dari LLM (bukan chatId mentah),
 *     dispatcher butuh tahu "grup mana yang lagi aktif buat sesi ini".
 *
 * PENTING soal WhatsApp: beda dengan Telegram (1 sesi = 1 chat, baik
 * personal maupun grup — lihat `sessions[chatId]` di telegram.js), sesi
 * WhatsApp di kode ini di-key per NOMOR PENGIRIM (`sessions[senderId]` di
 * whatsapp.js) — artinya satu orang yang sama membawa SATU sesi yang sama
 * walau dia chat dari grup berbeda-beda atau dari chat pribadi. Context ini
 * selalu di-update di setiap pesan masuk, jadi yang dipakai tool selalu
 * "chat tempat pesan TERAKHIR dari sesi ini datang" — sesuai ekspektasi
 * wajar: kalau user lagi nge-chat dari Grup A terus minta "kick si B", ya
 * yang dimaksud Grup A, bukan grup lain yang pernah dia singgahi.
 */

const contextMap = new Map(); // sessionId -> context

/**
 * @param {string} sessionId
 * @param {{
 *   platform: "telegram" | "whatsapp",
 *   chatId: string | number,
 *   chatType: "private" | "group",
 *   chatTitle?: string | null,
 *   senderId: string | number,
 *   senderName: string,
 *   senderIsAdmin: boolean | null,
 *   botIsAdmin: boolean | null,
 *   replyToMessage?: { id: string | number, participant?: string | null } | null,
 * }} ctx
 */
export function setContext(sessionId, ctx) {
  if (!sessionId) return;
  contextMap.set(sessionId, { ...ctx, updatedAt: Date.now() });
}

export function getContext(sessionId) {
  return contextMap.get(sessionId) || null;
}

export function clearContext(sessionId) {
  contextMap.delete(sessionId);
}

/**
 * Bikin header singkat satu baris yang disisipkan di depan tiap pesan user
 * sebelum dikirim ke LLM. Sengaja diringkas jadi satu baris (bukan blok
 * multi-baris) supaya gak boros token & gak bikin riwayat chat penuh noise
 * — tapi tetap "diingatkan ulang" tiap giliran, karena LLM gak bisa
 * diandalkan buat inget fakta dari jauh di riwayat percakapan yang panjang.
 *
 * Format ini sengaja dibuat gampang di-parse pola-nya (key=value) sambil
 * tetap kebaca manusia kalau di-debug manual.
 */
export function buildContextHeader(ctx) {
  if (!ctx) return "";

  const platform = ctx.platform === "whatsapp" ? "WhatsApp" : "Telegram";

  if (ctx.chatType !== "group") {
    return `[EMORA-CTX] platform=${platform} | chat=private | dari=${ctx.senderName || "user"}\n`;
  }

  const title = ctx.chatTitle ? `"${ctx.chatTitle}"` : "(tanpa nama)";
  const senderTag = ctx.senderIsAdmin === true ? "admin" : ctx.senderIsAdmin === false ? "member" : "?";
  const botTag = ctx.botIsAdmin === true ? "admin" : ctx.botIsAdmin === false ? "member" : "?";

  return `[EMORA-CTX] platform=${platform} | chat=group ${title} | dari=${ctx.senderName || "user"}(${senderTag}) | bot=${botTag}\n`;
}
