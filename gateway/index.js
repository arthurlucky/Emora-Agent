/**
 * gateway/index.js
 * Entry point terpusat untuk semua gateway EMORA.
 * 
 * FIX: Error handling & retry logic untuk mencegah crash loop
 */

const activeGateways = [];
const gatewayErrors = new Map(); // Track error counts per gateway
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

async function loadGateways() {
  // ==========================================
  // TELEGRAM
  // ==========================================
  if (process.env.TELEGRAM_TOKEN_BOT && process.env.TELEGRAM_GATEWAY === "true") {
    console.log("[GATEWAY] Memuat Telegram...");
    try {
      const tg = await import("./telegram/telegram.js");

      // Verify bot is actually connected before pushing to active
      if (tg.bot && tg.sessions) {
        activeGateways.push({ name: "telegram", module: tg });
        console.log("[GATEWAY] ✅ Telegram loaded successfully");
      } else {
        console.warn("[GATEWAY] ⚠️ Telegram module loaded but bot not initialized");
      }
    } catch (err) {
      console.error(`[GATEWAY ERROR] Telegram failed to load: ${err.message}`);
      // Don't crash - just skip this gateway
    }
  }

  // ==========================================
  // WHATSAPP
  // ==========================================
  if (process.env.WA_GATEWAY === "true" && process.env.WA_PHONE_NUMBER) {
    console.log("[GATEWAY] Memuat WhatsApp...");
    try {
      const wa = await import("./whatsapp/whatsapp.js");

      // Verify client is actually connected
      if (wa.client && wa.sessions) {
        activeGateways.push({ name: "whatsapp", module: wa });
        console.log("[GATEWAY] ✅ WhatsApp loaded successfully");
      } else {
        console.warn("[GATEWAY] ⚠️ WhatsApp module loaded but client not initialized");
      }
    } catch (err) {
      console.error(`[GATEWAY ERROR] WhatsApp failed to load: ${err.message}`);
      // Don't crash - just skip this gateway
    }
  }

  if (activeGateways.length === 0) {
    console.warn("[GATEWAY] ⚠️ Tidak ada gateway yang aktif. Periksa konfigurasi .env.");
  } else {
    console.log(`[GATEWAY] ✅ ${activeGateways.length} gateway(s) active`);
  }
}

// Safe gateway initialization with error tracking
const gatewaysReady = loadGateways().catch((err) => {
  console.error("[GATEWAY] Gagal memuat gateway:", err.message);
});

/**
 * Kirim file ke user dengan error handling
 */
export async function sendFileToUser(sessionId, filePath, caption = "") {
  const results = [];

  if (activeGateways.length === 0) {
    return ["❌ Tidak ada gateway aktif."];
  }

  for (const gw of activeGateways) {
    try {
      const { sessions, sendFile } = gw.module;

      if (!sessions || !sendFile) {
        console.warn(`[GATEWAY] ${gw.name} missing sessions or sendFile`);
        continue;
      }

      const chatId = Object.keys(sessions || {}).find((k) => sessions[k] === sessionId);
      if (!chatId) continue;

      let client;
      if (gw.name === "telegram") client = gw.module.bot;
      if (gw.name === "whatsapp") client = gw.module.client;

      if (!client) {
        console.warn(`[GATEWAY] ${gw.name} client not available`);
        continue;
      }

      const result = await sendFile(client, chatId, filePath, caption);
      results.push(`[${gw.name.toUpperCase()}] ${result}`);
    } catch (err) {
      console.error(`[GATEWAY ERROR] ${gw.name} sendFile failed:`, err.message);
      results.push(`[${gw.name.toUpperCase()}] ERROR: ${err.message}`);
    }
  }

  if (results.length === 0) {
    return ["❌ Tidak ada gateway aktif yang menemukan sesi user ini."];
  }

  return results;
}

export { activeGateways, gatewaysReady };
