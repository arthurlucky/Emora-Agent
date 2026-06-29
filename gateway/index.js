/**
 * gateway/index.js
 * Entry point terpusat untuk semua gateway EMORA.
 * Tidak auto‑load saat diimpor. Panggil initGateways() secara eksplisit.
 */

const activeGateways = [];

export async function initGateways() {
  if (activeGateways.length > 0) return activeGateways;

  // ===== TELEGRAM =====
  if (process.env.TELEGRAM_TOKEN_BOT && process.env.TELEGRAM_GATEWAY === "true") {
    console.log("[GATEWAY] Memuat Telegram...");
    try {
      const tg = await import("./telegram/telegram.js");
      if (tg.bot && tg.sessions) {
        activeGateways.push({ name: "telegram", module: tg });
        console.log("[GATEWAY] ✅ Telegram loaded");
      } else {
        console.warn("[GATEWAY] ⚠️ Telegram module loaded but bot not initialized");
      }
    } catch (err) {
      console.error(`[GATEWAY ERROR] Telegram: ${err.message}`);
    }
  }

  // ===== WHATSAPP =====
  if (process.env.WA_GATEWAY === "true" && process.env.WA_PHONE_NUMBER) {
    console.log("[GATEWAY] Memuat WhatsApp...");
    try {
      const wa = await import("./whatsapp/main.js");
      if (wa.client && wa.sessions) {
        activeGateways.push({ name: "whatsapp", module: wa });
        console.log("[GATEWAY] ✅ WhatsApp loaded");
      } else {
        console.warn("[GATEWAY] ⚠️ WhatsApp module loaded but client not initialized");
      }
    } catch (err) {
      console.error(`[GATEWAY ERROR] WhatsApp: ${err.message}`);
    }
  }

  if (activeGateways.length === 0) {
    console.warn("[GATEWAY] ⚠️ Tidak ada gateway aktif.");
  } else {
    console.log(`[GATEWAY] ✅ ${activeGateways.length} gateway aktif`);
  }
  return activeGateways;
}

export async function sendFileToUser(sessionId, filePath, caption = "") {
  if (activeGateways.length === 0) {
    return ["❌ Gateway tidak aktif. Jalankan 'emora gateway' terlebih dahulu."];
  }
  const results = [];
  for (const gw of activeGateways) {
    try {
      const { sessions, sendFile } = gw.module;
      if (!sessions || !sendFile) continue;
      const chatId = Object.keys(sessions).find((k) => sessions[k] === sessionId);
      if (!chatId) continue;

      let client;
      if (gw.name === "telegram") client = gw.module.bot;
      if (gw.name === "whatsapp") client = gw.module.client;
      if (!client) continue;

      const result = await sendFile(client, chatId, filePath, caption);
      results.push(`[${gw.name.toUpperCase()}] ${result}`);
    } catch (err) {
      console.error(`[GATEWAY ERROR] ${gw.name} sendFile:`, err.message);
      results.push(`[${gw.name.toUpperCase()}] ERROR: ${err.message}`);
    }
  }
  if (results.length === 0) return ["❌ Tidak ada gateway aktif yang menemukan sesi ini."];
  return results;
}

export async function sendProgressUpdate(sessionId, message) {
  if (activeGateways.length === 0) return false;
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
      console.error(`[GATEWAY ERROR] ${gw.name} sendProgressUpdate:`, err.message);
      return false;
    }
  }
  return false;
}

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
      console.error(`[GATEWAY ERROR] ${gw.name} handleGroupCommand:`, err.message);
      return `❌ Error perintah grup (${gw.name}): ${err.message}`;
    }
  }
  return "❌ Sesi ini tidak ditemukan di gateway manapun.";
}

export { activeGateways };