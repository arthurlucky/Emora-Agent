/**
 * whatsapp.js
 * Gateway WhatsApp menggunakan @whiskeysockets/baileys.
 * Koneksi via Pairing Code (tanpa scan QR).
 */

import "dotenv/config";
import crypto from "crypto";
import path from "path";
import fs, { rmSync } from "fs";

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  delay
} from "@whiskeysockets/baileys";
import pino from "pino";

import { ChatOpenAI } from "@langchain/openai";
import tools from "../../core/tools.js";
import { ask } from "../../core/chat.js";
import { handleCommand } from "../../core/cmd.js";
import { eventBus } from "../../utils/eventBus.js";

import { formatWhatsAppMessage } from "./formatter.js";
import { sendFile } from "./sender.js";
import { handleIncomingFile } from "./receiver.js";

const ALLOWED_NUMBERS = (process.env.WA_ALLOWED_NUMBERS || "")
  .split(",")
  .map((n) => `${n.trim().replace(/\D/g, "")}@s.whatsapp.net`)
  .filter(Boolean);

// ==========================================
// SESSION STORE
// ==========================================
export const sessions = {};
export let client = null;

const WA_PHONE = (process.env.WA_PHONE_NUMBER || "").replace(/[^0-9]/g, "");
const WA_GATEWAY = process.env.WA_GATEWAY;

if (WA_GATEWAY !== "true") {
  console.log("\n[WHATSAPP] Gateway dinonaktifkan (WA_GATEWAY != true).");
} else if (!WA_PHONE) {
  console.log("\n[WHATSAPP] WA_PHONE_NUMBER tidak ditemukan di .env. Gateway dibatalkan.");
} else {
  // ==========================================
  // LLM SETUP
  // ==========================================
  const llm = new ChatOpenAI({
    apiKey: process.env.MODEL_API || "ollama",
    model: process.env.MODEL_NAME,
    configuration: { baseURL: process.env.MODEL_URL },
    temperature: 0.2,
    maxTokens: 2048,
  }).bindTools(tools, { toolChoice: "auto" });

  // ==========================================
  // BACKGROUND TASK LISTENER
  // ==========================================
  const bgLocks = {};

  eventBus.on("execute_bg_task", async ({ job_id, session_id, prompt }) => {
    const phoneId = Object.keys(sessions).find((k) => sessions[k] === session_id);
    if (!phoneId || !client) return;
    if (bgLocks[job_id]) return;
    bgLocks[job_id] = true;

    try {
      const bgSessionId = `${session_id}_bg_${job_id}`;
      const result = await ask(llm, tools, bgSessionId, `[BACKGROUND TASK] ${prompt}`);

      if (!result.includes("SILENT_ABORT")) {
        await client.sendMessage(phoneId, {
          text: `🔔 *LAPORAN TERJADWAL*\n━━━━━━━━━━━━━━━━\n${formatWhatsAppMessage(result)}`
        });
      }
    } catch (err) {
      console.error(`[BG TASK WA] Job ${job_id}: ${err.message}`);
    } finally {
      bgLocks[job_id] = false;
    }
  });

  // ==========================================
  // CLIENT START & CONNECTION
  // ==========================================
  async function startWhatsApp() {
    try {
      const { version } = await fetchLatestBaileysVersion();
      const { state, saveCreds } = await useMultiFileAuthState(`./session`);

      client = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        browser: Browsers.macOS("Chrome"),
        auth: state,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
      });

      client.ev.on("creds.update", saveCreds);

      // ==========================================
      // PAIRING CODE (pengganti QR)
      // ==========================================
      const isRegistered = state.creds?.registered === true;
      if (!isRegistered) {
        setTimeout(async () => {
          try {
            console.log("\n[WHATSAPP] Meminta pairing code...");
            let code = await client.requestPairingCode(WA_PHONE);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            
            console.log("\n╔══════════════════════════════════╗");
            console.log("║   WHATSAPP PAIRING CODE          ║");
            console.log(`║   👉  ${code}              ║`);
            console.log("╚══════════════════════════════════╝");
            console.log("\nBuka WhatsApp → Perangkat Tertaut → Tautkan Perangkat dengan Nomor Telepon → Masukkan kode di atas.\n");
          } catch (error) {
            console.error("[WHATSAPP] Gagal mendapatkan pairing code:", error.message);
          }
        }, 3000);
      }

      // ==========================================
      // CONNECTION HANDLER
      // ==========================================
      client.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
          console.log("📱 [WHATSAPP] Gateway aktif dan siap menerima pesan.");
        }

        if (connection === "close") {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;

          if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
            console.error("[WHATSAPP] Sesi tidak valid / Logged Out. Menghapus sesi...");
            try {
              rmSync('./session', { recursive: true, force: true });
            } catch (e) { /* Abaikan error penghapusan */ }
            await delay(3000);
            startWhatsApp();
            return;
          }

          if (shouldReconnect) {
            console.log("[WHATSAPP] Koneksi terputus. Mencoba reconnect dalam 5 detik...");
            await delay(5000);
            startWhatsApp();
          }
        }
      });

      // ==========================================
      // MESSAGE HANDLER
      // ==========================================
      client.ev.on("messages.upsert", async (chatUpdate) => {
        try {
          const msg = chatUpdate.messages[0];
          
          if (!msg.message || msg.key.fromMe) return;

          // Ekstrak pesan sebenarnya (menangani tipe ephemeral)
          msg.message = (Object.keys(msg.message)[0] === 'ephemeralMessage') 
            ? msg.message.ephemeralMessage.message 
            : msg.message;

          const senderId = msg.key.remoteJidAlt;
          const group = msg.key?.remoteJid;
          
          const isGroup = group.endsWith("@g.us");

          // Abaikan grup
          if (isGroup) return;

          // Hanya nomor yang ada di whitelist
          if (ALLOWED_NUMBERS.length > 0 && !ALLOWED_NUMBERS.includes(senderId)) {
            console.log(`[WA BLOCKED] ${senderId}`);
            return;
          }

          if (!sessions[senderId]) {
            sessions[senderId] = crypto.randomUUID();
          }

          const messageType = Object.keys(msg.message)[0];
          const hasMedia = ["imageMessage", "videoMessage", "documentMessage", "audioMessage"].includes(messageType);
          
          // Helper untuk membalas pesan
          const reply = async (text) => {
            return await client.sendMessage(senderId, { text }, { quoted: msg });
          };

          // ==========================================
          // HANDLER FILE
          // ==========================================
          if (hasMedia) {
            // Catatan: Pastikan `handleIncomingFile` di receiver.js sudah disesuaikan
            // untuk memproses objek pesan dari Baileys, bukan whatsapp-web.js
            const confirmation = await handleIncomingFile(msg, client);

            if (confirmation) {
              await reply(confirmation);

              const sessionId = sessions[senderId];
              const caption = msg.message[messageType]?.caption || "";

              const prompt = `[FILE DITERIMA] ${confirmation}` + (caption ? `\nPesan user: ${caption}` : "");

              try {
                const result = await ask(llm, tools, sessionId, prompt);
                if (result?.trim()) {
                  await reply(formatWhatsAppMessage(result));
                }
              } catch (err) {
                console.error("[WA FILE HANDLER]", err.message);
              }
            }
            return;
          }

          // ==========================================
          // HANDLER TEXT
          // ==========================================
          const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
          if (!text.trim()) return;

          const localState = {
            currentSession: sessions[senderId],
          };

          const commandResult = handleCommand(text, localState);

          if (commandResult) {
            sessions[senderId] = localState.currentSession;

            if (commandResult.action === "exit") {
              await reply("❌ Command /exit tidak tersedia di WhatsApp.");
            } else if (commandResult.action === "reply") {
              await reply(`⚙️ *SISTEM*\n━━━━━━━━━━━━━━━━\n_${commandResult.message}_`);
            }
            return;
          }

          const sessionId = sessions[senderId];

          // Indikator sedang mengetik
          await client.sendPresenceUpdate("composing", senderId);

          try {
            const result = await ask(llm, tools, sessionId, text);

            await client.sendPresenceUpdate("paused", senderId);
            await reply(formatWhatsAppMessage(result));
          } catch (err) {
            await client.sendPresenceUpdate("paused", senderId);
            console.error("[WHATSAPP ERROR]", err.message);
            await reply(`⚠️ Terjadi kesalahan: ${err.message}`);
          }

        } catch (err) {
          console.error("[WHATSAPP UPSERT ERROR]", err.message);
        }
      });

    } catch (error) {
      console.error("[WHATSAPP INIT ERROR]", error.message);
    }
  }

  // ==========================================
  // LAUNCH
  // ==========================================
  startWhatsApp();
}

export { sendFile };
