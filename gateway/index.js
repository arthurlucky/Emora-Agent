/**
 * gateway/index.js
 * Entry point terpusat untuk semua gateway EMORA.
 *
 * Mengatur inisialisasi gateway berdasarkan konfigurasi .env.
 * Mengekspor helper sendFileToUser() yang otomatis memilih gateway aktif.
 *
 * Gateway yang tersedia:
 *  - Telegram  (TELEGRAM_TOKEN_BOT)
 *  - WhatsApp  (WA_GATEWAY=true + WA_PHONE_NUMBER)
 */

const activeGateways = [];

// ==========================================
// TELEGRAM
// ==========================================
if (process.env.TELEGRAM_TOKEN_BOT && process.env.TELEGRAM_GATEWAY === "true") {
  console.log("[GATEWAY] Memuat Telegram...");
  const tg = await import("./telegram/telegram.js");
  activeGateways.push({ name: "telegram", module: tg });
}

// ==========================================
// WHATSAPP
// ==========================================
if (process.env.WA_GATEWAY === "true" && process.env.WA_PHONE_NUMBER) {
  console.log("[GATEWAY] Memuat WhatsApp...");
  const wa = await import("./whatsapp/whatsapp.js");
  activeGateways.push({ name: "whatsapp", module: wa });
}

if (activeGateways.length === 0) {
  console.warn("[GATEWAY] ⚠️  Tidak ada gateway yang aktif. Periksa konfigurasi .env.");
}

export { activeGateways };

/**
 * Kirim file ke user via semua gateway yang aktif dan memiliki sesi user.
 *
 * @param {string} sessionId  - Session ID user
 * @param {string} filePath   - Path absolut ke file
 * @param {string} caption    - Caption opsional
 * @returns {Promise<string[]>} - Hasil dari tiap gateway
 */
export async function sendFileToUser(sessionId, filePath, caption = "") {
  const results = [];

  for (const gw of activeGateways) {
    const { sessions, sendFile } = gw.module;

    const chatId = Object.keys(sessions || {}).find((k) => sessions[k] === sessionId);
    if (!chatId) continue;

    let client;
    if (gw.name === "telegram") client = gw.module.bot;
    if (gw.name === "whatsapp") client = gw.module.client;

    if (!client) continue;

    const result = await sendFile(client, chatId, filePath, caption);
    results.push(`[${gw.name.toUpperCase()}] ${result}`);
  }

  if (results.length === 0) {
    return ["❌ Tidak ada gateway aktif yang menemukan sesi user ini."];
  }

  return results;
}
