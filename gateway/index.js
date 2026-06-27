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

export async function loadGateways() {
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
      const wa = await import("./whatsapp/main.js");

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
// Auto-load gateway saat di-import oleh main.js atau telegram/whatsapp.js.
// cmd-gateway.js memanggil loadGateways() manual — guard ini mencegah
// double-load kalau file ini di-import lebih dari sekali dalam satu proses.
let gatewaysReady;
if (!process.env._EMORA_GATEWAY_MANUAL) {
  gatewaysReady = loadGateways().catch((err) => {
    console.error("[GATEWAY] Gagal memuat gateway:", err.message);
  });
}

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

/**
 * Jalankan perintah manajemen grup (kick/promote/list member/dll) untuk
 * sesi tertentu, otomatis ke-routing ke platform yang tepat (Telegram atau
 * WhatsApp) tergantung sesi itu lagi aktif di gateway mana.
 *
 * Ini titik integrasi yang disarankan buat tool baru di core/tools.js —
 * tinggal satu fungsi, gak perlu tau itu sesi Telegram atau WhatsApp.
 * Daftar perintah yang didukung ada di telegram/groupCommand.js dan
 * whatsapp/groupCommand.js (groupStatus, groupListAdmins, groupListMembers,
 * groupKick, groupAdd*, groupPromote, groupDemote, groupDeleteMessage,
 * groupInviteLink*). *khusus salah satu platform, lihat masing-masing file.
 *
 * @param {string} sessionId
 * @param {string} command - Raw command string, mis. `groupKick --userId="123"`
 * @returns {Promise<string>}
 */
export async function handleGroupCommand(sessionId, command) {
  for (const gw of activeGateways) {
    const { sessions } = gw.module;
    if (!sessions) continue;

    const isKnownSession = Object.values(sessions).includes(sessionId);
    if (!isKnownSession) continue;

    try {
      if (gw.name === "telegram") {
        const { handleGroupCommand: handler } = await import("./telegram/groupCommand.js");
        return await handler(command, sessionId);
      }
      if (gw.name === "whatsapp") {
        const { handleGroupCommand: handler } = await import("./whatsapp/groupCommand.js");
        return await handler(command, sessionId);
      }
    } catch (err) {
      console.error(`[GATEWAY ERROR] ${gw.name} handleGroupCommand gagal:`, err.message);
      return `❌ Error perintah grup (${gw.name}): ${err.message}`;
    }
  }

  return "❌ Sesi ini tidak ditemukan di gateway Telegram/WhatsApp manapun.";
}

/**
 * Kirim satu pesan progress/status ke chat asal sesi tertentu (Telegram
 * atau WhatsApp, otomatis terdeteksi). Dipakai tool-tool yang punya proses
 * panjang (mis. project_manager) buat ngasih kabar tiap langkah, tanpa
 * nunggu balasan akhir.
 *
 * No-op (return false) kalau sesi ini bukan dari WhatsApp/Telegram (mis.
 * CLI atau Web UI) — di sana progress udah kelihatan lewat cara lain.
 *
 * @param {string} sessionId
 * @param {string} message
 * @returns {Promise<boolean>}
 */
export async function sendProgressUpdate(sessionId, message) {
  if (!sessionId || !message) return false;

  for (const gw of activeGateways) {
    const { sessions } = gw.module;
    if (!sessions) continue;

    const chatId = Object.keys(sessions).find((k) => sessions[k] === sessionId);
    if (!chatId) continue;

    try {
      if (gw.name === "telegram") {
        const { sendSafeMessage } = await import("./telegram/sender.js");
        await sendSafeMessage(gw.module.bot, message, true, { chatId });
        return true;
      }
      if (gw.name === "whatsapp") {
        const { sendText } = await import("./whatsapp/sender.js");
        const { formatWhatsAppMessage } = await import("./whatsapp/formatter.js");
        await sendText(gw.module.client, chatId, formatWhatsAppMessage(message));
        return true;
      }
    } catch (err) {
      console.error(`[GATEWAY ERROR] ${gw.name} sendProgressUpdate gagal:`, err.message);
      return false;
    }
  }

  return false; // sesi gak ketemu di gateway manapun -> kemungkinan CLI/Web UI
}

/**
 * Kirim serangkaian langkah (mis. dari project_manager) satu-satu ke chat
 * asal sesi, dengan jeda di antaranya, biar user bisa "ngikutin" prosesnya
 * real-time alih-alih cuma nerima hasil akhir sekaligus.
 *
 * No-op kalau sesi bukan dari WhatsApp/Telegram (lihat sendProgressUpdate).
 *
 * @param {string} sessionId
 * @param {string[]} steps - Daftar deskripsi langkah, urut.
 * @param {{ delayMs?: number, prefix?: string }} [options]
 */
export async function sendStepSequence(sessionId, steps, { delayMs = 1000, prefix = "🔧" } = {}) {
  if (!Array.isArray(steps) || steps.length === 0) return;

  const isMessagingSession = activeGateways.some((gw) =>
    Object.values(gw.module.sessions || {}).includes(sessionId)
  );
  if (!isMessagingSession) return;

  for (let i = 0; i < steps.length; i++) {
    const stepText = `${prefix} *Langkah ${i + 1}/${steps.length}*\n${steps[i]}`;
    await sendProgressUpdate(sessionId, stepText);
    if (i < steps.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export { activeGateways, gatewaysReady };
