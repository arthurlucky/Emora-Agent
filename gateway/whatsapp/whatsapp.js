/**
 * whatsapp.js
 * Gateway WhatsApp menggunakan @whiskeysockets/baileys.
 * Koneksi via Pairing Code (tanpa scan QR).
 * 
 * FIX: Error handling, reconnect logic, file download & processing
 */

import "dotenv/config";
import crypto from "crypto";
import path from "path";
import fs, { rmSync, mkdirSync, existsSync } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  delay,
  downloadMediaMessage,
  proto
} from "@whiskeysockets/baileys";
import pino from "pino";

import { ChatOpenAI } from "@langchain/openai";
import tools from "../../core/tools.js";
import { ask } from "../../core/chat.js";
import { handleCommand } from "../../core/cmd.js";
import { eventBus } from "../../utils/eventBus.js";

import { formatWhatsAppMessage } from "./formatter.js";
import { sendFile } from "./sender.js";
import { getBotStatus, getMemberStatus } from "./groupManager.js";
import { setContext, buildContextHeader } from "../sessionContext.js";

const ALLOWED_NUMBERS = (process.env.WA_ALLOWED_NUMBERS || "")
  .split(",")
  .map((n) => `${n.trim().replace(/\D/g, "")}@s.whatsapp.net`)
  .filter(Boolean);

// ==========================================
// SESSION STORE
// ==========================================
export const sessions = {};
export let client = null;

// ==========================================
// DOWNLOAD DIRECTORY
// ==========================================
const DOWNLOAD_DIR = "./downloads/whatsapp";
if (!existsSync(DOWNLOAD_DIR)) {
  mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

const WA_PHONE = (process.env.WA_PHONE_NUMBER || "").replace(/[^0-9]/g, "");
const WA_GATEWAY = process.env.WA_GATEWAY;

// ==========================================
// LLM SETUP
// ==========================================
let llm = null;

if (WA_GATEWAY !== "true") {
  console.log("\n[WHATSAPP] Gateway dinonaktifkan (WA_GATEWAY != true).");
} else if (!WA_PHONE) {
  console.log("\n[WHATSAPP] WA_PHONE_NUMBER tidak ditemukan di .env. Gateway dibatalkan.");
} else {
  llm = new ChatOpenAI({
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

  // ==========================================
  // CONTEXT AWARENESS (grup/private, platform, status admin)
  // ==========================================
  /**
   * Bangun & simpan konteks pesan saat ini (platform, grup/private, status
   * admin EMORA & pengirim) ke sessionContext, lalu balikin objeknya.
   * Status admin & nama grup cuma di-cek kalau chat-nya grup (hemat round
   * trip groupMetadata buat chat personal).
   */
  async function buildWhatsAppContext(sessionId, { senderId, group, isGroup, senderName, replyToMessage }) {
    let senderIsAdmin = null;
    let botIsAdmin = null;
    let chatTitle = null;

    if (isGroup) {
      try {
        const [botStatus, memberStatus] = await Promise.all([
          getBotStatus(client, group),
          getMemberStatus(client, group, senderId),
        ]);
        chatTitle = botStatus.groupName || null;
        botIsAdmin = botStatus.isAdmin;
        senderIsAdmin = memberStatus.isAdmin;
      } catch (err) {
        console.warn("[WA CONTEXT] Gagal cek status admin/grup:", err.message);
      }
    }

    const context = {
      platform: "whatsapp",
      chatId: group,
      chatType: isGroup ? "group" : "private",
      chatTitle,
      senderId,
      senderName,
      senderIsAdmin,
      botIsAdmin,
      replyToMessage: replyToMessage || null,
    };

    setContext(sessionId, context);
    return context;
  }

  /**
   * Ambil info pesan yang sedang di-reply user (kalau ada), dipakai buat
   * fitur groupDeleteMessage. Baileys naruh info ini di `contextInfo` pada
   * tipe pesan yang membawa reply (paling umum extendedTextMessage).
   */
  function extractQuotedInfo(msg) {
    const messageType = Object.keys(msg.message || {})[0];
    const content = msg.message?.[messageType];
    const contextInfo = content?.contextInfo;
    if (!contextInfo?.stanzaId) return null;
    return {
      id: contextInfo.stanzaId,
      participant: contextInfo.participant || null,
    };
  }

  /**
   * Sama kayak `ask()` biasa, tapi otomatis nyisipin header konteks
   * (platform/grup/admin) di depan pesan, biar agent selalu tau lagi
   * ngobrol di mana & posisinya apa sebelum mikirin balasan/tool call.
   */
  async function askWithContext(sessionId, contextInput, rawMessage) {
    const context = await buildWhatsAppContext(sessionId, contextInput);
    const enriched = buildContextHeader(context) + rawMessage;
    return ask(llm, tools, sessionId, enriched);
  }

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
  // FILE DOWNLOAD HELPER
  // ==========================================
  async function downloadWhatsAppFile(msg, messageType) {
    try {
      const mediaMessage = msg.message[messageType];
      const mimeType = mediaMessage.mimetype || "application/octet-stream";
      const extension = mimeType.split("/")[1]?.split(";")[0] || "bin";
      
      // Generate unique filename
      const timestamp = Date.now();
      const randomStr = crypto.randomBytes(4).toString("hex");
      const filename = `wa_${timestamp}_${randomStr}.${extension}`;
      const filePath = path.join(DOWNLOAD_DIR, filename);

      // Download using Baileys built-in downloadMediaMessage
      const stream = await downloadMediaMessage(
        msg,
        "buffer",
        {},
        {
          logger: pino({ level: "silent" }),
          reuploadRequest: client.updateMediaMessage
        }
      );

      if (!stream) {
        throw new Error("Failed to download media - stream is empty");
      }

      // Save to file
      fs.writeFileSync(filePath, stream);

      // Get file info
      const stats = fs.statSync(filePath);
      const fileSize = (stats.size / 1024).toFixed(2); // KB

      return {
        success: true,
        filePath,
        filename,
        mimeType,
        size: fileSize,
        extension
      };
    } catch (err) {
      console.error("[WA FILE DOWNLOAD ERROR]", err.message);
      return {
        success: false,
        error: err.message
      };
    }
  }

  // ==========================================
  // FILE PROCESSING - Analyze file content based on type
  // ==========================================
  async function processFileWithAI(fileInfo, caption, sessionId, msg, messageType) {
    const { filePath, filename, mimeType, size, extension } = fileInfo;
    
    let fileDescription = "";
    let analysisPrompt = "";

    // Determine file type category
    const isImage = mimeType.startsWith("image/");
    const isVideo = mimeType.startsWith("video/");
    const isAudio = mimeType.startsWith("audio/");
    const isDocument = mimeType.startsWith("application/") || mimeType.startsWith("text/");
    const isPDF = extension === "pdf" || mimeType === "application/pdf";

    // Build file description
    if (isImage) {
      fileDescription = `📷 Gambar (${extension.toUpperCase()}, ${size}KB)`;
      analysisPrompt = `User mengirim gambar: "${filename}" (${size}KB). ${caption ? `Caption: "${caption}"` : "Tidak ada caption."}\n\nAnalisis gambar ini. Jika user meminta sesuatu terkait gambar (edit, describe, analyze, extract text, dll), lakukan sesuai permintaan. Jika tidak ada permintaan spesifik, berikan deskripsi umum gambar tersebut.`;
    } else if (isVideo) {
      fileDescription = `🎥 Video (${extension.toUpperCase()}, ${size}KB)`;
      analysisPrompt = `User mengirim video: "${filename}" (${size}KB). ${caption ? `Caption: "${caption}"` : "Tidak ada caption."}\n\nAnalisis video ini. Jika user meminta sesuatu terkait video (extract frames, describe, summarize, dll), lakukan sesuai permintaan.`;
    } else if (isAudio) {
      fileDescription = `🎵 Audio (${extension.toUpperCase()}, ${size}KB)`;
      analysisPrompt = `User mengirim audio: "${filename}" (${size}KB). ${caption ? `Caption: "${caption}"` : "Tidak ada caption."}\n\nAnalisis audio ini. Jika user meminta transkripsi, summary, atau analisis audio, lakukan sesuai permintaan.`;
    } else if (isPDF) {
      fileDescription = `📄 PDF (${size}KB)`;
      analysisPrompt = `User mengirim file PDF: "${filename}" (${size}KB). ${caption ? `Caption: "${caption}"` : "Tidak ada caption."}\n\nBaca dan analisis konten PDF ini. Jika user meminta summary, extract text, atau analisis spesifik, lakukan sesuai permintaan.`;
    } else if (isDocument) {
      fileDescription = `📄 Dokumen (${extension.toUpperCase()}, ${size}KB)`;
      analysisPrompt = `User mengirim dokumen: "${filename}" (${size}KB, type: ${mimeType}). ${caption ? `Caption: "${caption}"` : "Tidak ada caption."}\n\nAnalisis dokumen ini. Jika user meminta extract text, summary, convert, atau manipulasi file, lakukan sesuai permintaan.`;
    } else {
      fileDescription = `📎 File (${extension.toUpperCase()}, ${size}KB)`;
      analysisPrompt = `User mengirim file: "${filename}" (${size}KB, type: ${mimeType}). ${caption ? `Caption: "${caption}"` : "Tidak ada caption."}\n\nFile telah disimpan di: ${filePath}\n\nJika user meminta sesuatu terkait file ini (baca, convert, analyze, dll), lakukan sesuai permintaan.`;
    }

    // Read file content if it's text-based
    let fileContent = "";
    if (mimeType.startsWith("text/") || extension === "txt" || extension === "md" || extension === "json" || extension === "csv") {
      try {
        fileContent = fs.readFileSync(filePath, "utf8");
        if (fileContent.length > 10000) {
          fileContent = fileContent.substring(0, 10000) + "\n... [truncated, file too large]";
        }
        analysisPrompt += `\n\nKonten file:\n\`\`\`\n${fileContent}\n\`\`\``;
      } catch (err) {
        console.error("[WA FILE READ ERROR]", err.message);
      }
    }

    // Send confirmation to user
    const confirmation = `✅ *File Diterima*\n━━━━━━━━━━━━━━━━\n📁 Nama: ${filename}\n📊 Ukuran: ${size}KB\n📂 Tipe: ${mimeType}\n💾 Lokasi: ${filePath}\n\n${caption ? `📝 Caption: ${caption}` : ""}\n\nSedang menganalisis...`;

    return { confirmation, analysisPrompt, filePath, fileDescription };
  }

  // ==========================================
  // CLIENT START & CONNECTION
  // ==========================================
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;
  let isShuttingDown = false;

  async function startWhatsApp() {
    if (isShuttingDown) return;

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
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        defaultQueryTimeoutMs: 60000,
        retryRequestDelayMs: 250,
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
            console.log("║      WHATSAPP PAIRING CODE       ║");
            console.log(`║     👉 ${code}     ║`);
            console.log("╚══════════════════════════════════╝");
            console.log("\nBuka WhatsApp → Perangkat Tertaut → Tautkan Perangkat dengan Nomor Telepon → Masukkan kode di atas.\n");
          } catch (error) {
            console.error("[WHATSAPP] Gagal mendapatkan pairing code:", error.message);
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
              reconnectAttempts++;
              console.log(`[WHATSAPP] Retrying pairing... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
              await delay(5000 * reconnectAttempts);
              startWhatsApp();
            }
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
          reconnectAttempts = 0;
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
            reconnectAttempts = 0;
            startWhatsApp();
            return;
          }

          if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            const delayMs = Math.min(5000 * reconnectAttempts, 30000);
            console.log(`[WHATSAPP] Koneksi terputus. Mencoba reconnect dalam ${delayMs/1000} detik... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
            await delay(delayMs);
            startWhatsApp();
          } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.error("[WHATSAPP ERROR] Max reconnect attempts reached. Gateway will not restart.");
            client = null;
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

          const senderId = msg.key.remoteJidAlt ?? msg.key.participantAlt;
          const key = msg.key.remoteJidAlt ?? msg.key.remoteJid;
          const group = msg.key?.remoteJid;

          const isGroup = group.endsWith("@g.us");
          const senderName = msg.pushName || senderId;
          const replyToMessage = extractQuotedInfo(msg);
          const contextInput = { senderId, group, isGroup, senderName, replyToMessage };

          
          // Hanya nomor yang ada di whitelist
          if (ALLOWED_NUMBERS.length > 0 && !ALLOWED_NUMBERS.includes(senderId)) {
            console.log(`[WA BLOCKED] ${senderId}`);
            return;
          }

          if (!sessions[senderId]) {
            sessions[senderId] = crypto.randomUUID();
          }

          const messageType = Object.keys(msg.message)[0];
          const hasMedia = ["imageMessage", "videoMessage", "documentMessage", "audioMessage", "stickerMessage"].includes(messageType);

          // Helper untuk membalas pesan
          const reply = async (text) => {
            return await client.sendMessage(key, { text }, { quoted: msg });
          };

          // ==========================================
          // HANDLER FILE (IMAGE, VIDEO, DOCUMENT, AUDIO)
          // ==========================================
          if (hasMedia) {
            try {
              // Download file
              const downloadResult = await downloadWhatsAppFile(msg, messageType);
              
              if (!downloadResult.success) {
                await reply(`❌ *Gagal Download File*\n━━━━━━━━━━━━━━━━\nError: ${downloadResult.error}`);
                return;
              }

              // Process file with AI context
              const caption = msg.message[messageType]?.caption || "";
              const sessionId = sessions[senderId];
              
              const { confirmation, analysisPrompt } = await processFileWithAI(
                downloadResult, 
                caption, 
                sessionId, 
                msg, 
                messageType
              );

              // Send confirmation
              await reply(confirmation);

              // Send to AI for analysis
              try {
                const result = await askWithContext(sessionId, contextInput, analysisPrompt);
                if (result?.trim()) {
                  await reply(formatWhatsAppMessage(result));
                }
              } catch (err) {
                console.error("[WA AI FILE ANALYSIS ERROR]", err.message);
                await reply(`⚠️ *Error Analisis File*\n━━━━━━━━━━━━━━━━\n${err.message}\n\nFile tetap tersimpan di: ${downloadResult.filePath}`);
              }

            } catch (err) {
              console.error("[WA FILE HANDLER ERROR]", err.message);
              await reply(`⚠️ *Error Memproses File*\n━━━━━━━━━━━━━━━━\n${err.message}`);
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

          const commandResult = await handleCommand(text, localState);

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
            const result = await askWithContext(sessionId, contextInput, text);

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
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        console.log(`[WHATSAPP] Retrying init... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        await delay(5000 * reconnectAttempts);
        startWhatsApp();
      }
    }
  }

  // ==========================================
  // LAUNCH
  // ==========================================
  startWhatsApp();

  // Graceful shutdown
  process.on("SIGINT", () => {
    isShuttingDown = true;
    console.log("\n[WHATSAPP] Shutting down gracefully...");
    process.exit(0);
  });
}

export { sendFile };
