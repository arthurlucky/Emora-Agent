/**
 * telegram.js
 * Gateway utama Telegram.
 * Menggabungkan: formatter, sender, receiver, dan core chat/cmd.
 * 
 * FIX: Error handling, reconnect logic, file download & processing
 */

import "dotenv/config";
import crypto from "crypto";
import path from "path";
import fs, { mkdirSync, existsSync } from "fs";
import { pipeline } from "stream/promises";

import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";

import { ChatOpenAI } from "@langchain/openai";
import tools from "../../core/tools.js";
import { ask } from "../../core/chat.js";
import { handleCommand } from "../../core/cmd.js";
import { eventBus } from "../../utils/eventBus.js";

import { formatTelegramMessage } from "./formatter.js";
import { sendSafeMessage, sendFile } from "./sender.js";

const ALLOWED_IDS = (process.env.TELEGRAM_ALLOWED_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

function isAllowed(chatId) {
  return (
    ALLOWED_IDS.length === 0 ||
    ALLOWED_IDS.includes(String(chatId))
  );
}

// ==========================================
// DOWNLOAD DIRECTORY
// ==========================================
const DOWNLOAD_DIR = "./downloads/telegram";
if (!existsSync(DOWNLOAD_DIR)) {
  mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

const token = process.env.TELEGRAM_TOKEN_BOT;

// ==========================================
// LLM
// ==========================================
let llm = null;

// ==========================================
// EXPORT sessions & bot (digunakan sender.js via sendfile tool)
// ==========================================
export const sessions = {};
export let bot = null;

if (!token) {
  console.log("\n[TELEGRAM] Token tidak ditemukan. Gateway dibatalkan.");
} else {
  llm = new ChatOpenAI({
    apiKey: process.env.MODEL_API || "ollama",
    model: process.env.MODEL_NAME,
    configuration: { baseURL: process.env.MODEL_URL },
    temperature: 0.2,
    maxTokens: 2048,
  }).bindTools(tools, { toolChoice: "auto" });

  bot = new Telegraf(token, {
    handlerTimeout: 90000,
  });

  const bgLocks = {};

  // ==========================================
  // BACKGROUND TASK LISTENER
  // ==========================================
  eventBus.on("execute_bg_task", async ({ job_id, session_id, prompt }) => {
    const chatId = Object.keys(sessions).find((k) => sessions[k] === session_id);
    if (!chatId) return;
    if (bgLocks[job_id]) return;
    bgLocks[job_id] = true;

    try {
      const bgSessionId = `${session_id}_bg_${job_id}`;
      const result = await ask(llm, tools, bgSessionId, `[BACKGROUND TASK] ${prompt}`);

      if (!result.includes("SILENT_ABORT")) {
        const msg = `🔔 *LAPORAN TERJADWAL*\n━━━━━━━━━━━━━━━━━━━━\n${formatTelegramMessage(result)}`;
        await sendSafeMessage(bot, msg, true, { chatId });
      }
    } catch (err) {
      console.error(`[BG TASK TG] Job ${job_id}: ${err.message}`);
    } finally {
      bgLocks[job_id] = false;
    }
  });

  // ==========================================
  // FILE DOWNLOAD HELPER
  // ==========================================
  async function downloadTelegramFile(ctx, fileId, fileType) {
    try {
      // Get file info from Telegram
      const fileInfo = await ctx.telegram.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
      
      // Determine filename
      const originalName = fileInfo.file_path.split("/").pop();
      const extension = originalName.split(".").pop() || "bin";
      const timestamp = Date.now();
      const randomStr = crypto.randomBytes(4).toString("hex");
      const filename = `tg_${fileType}_${timestamp}_${randomStr}.${extension}`;
      const filePath = path.join(DOWNLOAD_DIR, filename);

      // Download file using fetch
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      fs.writeFileSync(filePath, Buffer.from(buffer));

      // Get file info
      const stats = fs.statSync(filePath);
      const fileSize = (stats.size / 1024).toFixed(2); // KB

      return {
        success: true,
        filePath,
        filename,
        originalName,
        mimeType: response.headers.get("content-type") || "application/octet-stream",
        size: fileSize,
        extension
      };
    } catch (err) {
      console.error("[TG FILE DOWNLOAD ERROR]", err.message);
      return {
        success: false,
        error: err.message
      };
    }
  }

  // ==========================================
  // FILE PROCESSING - Analyze file content based on type
  // ==========================================
  async function processFileWithAI(fileInfo, caption, sessionId, ctx, fileType) {
    const { filePath, filename, originalName, mimeType, size, extension } = fileInfo;
    
    let fileDescription = "";
    let analysisPrompt = "";

    // Determine file type category
    const isImage = fileType === "photo" || mimeType.startsWith("image/");
    const isVideo = fileType === "video" || mimeType.startsWith("video/");
    const isAudio = fileType === "audio" || fileType === "voice" || mimeType.startsWith("audio/");
    const isDocument = fileType === "document";
    const isPDF = extension === "pdf" || mimeType === "application/pdf";

    // Build file description
    if (isImage) {
      fileDescription = `📷 Gambar (${extension.toUpperCase()}, ${size}KB)`;
      analysisPrompt = `User mengirim gambar: "${originalName}" (${size}KB). ${caption ? `Caption: "${caption}"` : "Tidak ada caption."}\n\nAnalisis gambar ini. Jika user meminta sesuatu terkait gambar (edit, describe, analyze, extract text/OCR, dll), lakukan sesuai permintaan. Jika tidak ada permintaan spesifik, berikan deskripsi umum gambar tersebut.`;
    } else if (isVideo) {
      fileDescription = `🎥 Video (${extension.toUpperCase()}, ${size}KB)`;
      analysisPrompt = `User mengirim video: "${originalName}" (${size}KB). ${caption ? `Caption: "${caption}"` : "Tidak ada caption."}\n\nAnalisis video ini. Jika user meminta sesuatu terkait video (extract frames, describe, summarize, dll), lakukan sesuai permintaan.`;
    } else if (isAudio) {
      fileDescription = `🎵 Audio (${extension.toUpperCase()}, ${size}KB)`;
      analysisPrompt = `User mengirim audio: "${originalName}" (${size}KB). ${caption ? `Caption: "${caption}"` : "Tidak ada caption."}\n\nAnalisis audio ini. Jika user meminta transkripsi, summary, atau analisis audio, lakukan sesuai permintaan.`;
    } else if (isPDF) {
      fileDescription = `📄 PDF (${size}KB)`;
      analysisPrompt = `User mengirim file PDF: "${originalName}" (${size}KB). ${caption ? `Caption: "${caption}"` : "Tidak ada caption."}\n\nBaca dan analisis konten PDF ini. Jika user meminta summary, extract text, atau analisis spesifik, lakukan sesuai permintaan.`;
    } else if (isDocument) {
      fileDescription = `📄 Dokumen (${extension.toUpperCase()}, ${size}KB)`;
      analysisPrompt = `User mengirim dokumen: "${originalName}" (${size}KB, type: ${mimeType}). ${caption ? `Caption: "${caption}"` : "Tidak ada caption."}\n\nAnalisis dokumen ini. Jika user meminta extract text, summary, convert, atau manipulasi file, lakukan sesuai permintaan.`;
    } else {
      fileDescription = `📎 File (${extension.toUpperCase()}, ${size}KB)`;
      analysisPrompt = `User mengirim file: "${originalName}" (${size}KB, type: ${mimeType}). ${caption ? `Caption: "${caption}"` : "Tidak ada caption."}\n\nFile telah disimpan di: ${filePath}\n\nJika user meminta sesuatu terkait file ini (baca, convert, analyze, dll), lakukan sesuai permintaan.`;
    }

    // Read file content if it's text-based
    let fileContent = "";
    if (mimeType.startsWith("text/") || extension === "txt" || extension === "md" || extension === "json" || extension === "csv" || extension === "js" || extension === "html" || extension === "css") {
      try {
        fileContent = fs.readFileSync(filePath, "utf8");
        if (fileContent.length > 10000) {
          fileContent = fileContent.substring(0, 10000) + "\n... [truncated, file too large]";
        }
        analysisPrompt += `\n\nKonten file:\n\`\`\`\n${fileContent}\n\`\`\``;
      } catch (err) {
        console.error("[TG FILE READ ERROR]", err.message);
      }
    }

    // Send confirmation to user
    const confirmation = `✅ *File Diterima*\n━━━━━━━━━━━━━━━━━━━━\n📁 Nama: ${originalName}\n📊 Ukuran: ${size}KB\n📂 Tipe: ${mimeType}\n💾 Lokasi: ${filePath}\n\n${caption ? `📝 Caption: ${caption}` : ""}\n\nSedang menganalisis...`;

    return { confirmation, analysisPrompt, filePath, fileDescription };
  }

  // ==========================================
  // HANDLER: PESAN TEKS
  // ==========================================
  bot.on(message("text"), async (ctx) => {
    const chatId = ctx.chat.id;

    if (!isAllowed(chatId)) {
      console.log(`[TG BLOCKED] ${chatId}`);
      return;
    }

    const text = ctx.message.text;

    if (!sessions[chatId]) {
      sessions[chatId] = crypto.randomUUID();
    }

    const localState = { currentSession: sessions[chatId] };
    const commandResult = handleCommand(text, localState);

    if (commandResult) {
      sessions[chatId] = localState.currentSession;

      if (commandResult.action === "exit") {
        await ctx.reply("❌ Command /exit tidak dapat digunakan di Telegram.");
      } else if (commandResult.action === "reply") {
        const msg = `⚙️ *SISTEM*\n━━━━━━━━━━━━━━━━━━━━\n_${commandResult.message}_`;
        await sendSafeMessage(ctx, msg);
      }

      return;
    }

    const sessionId = sessions[chatId];
    let isTyping = true;

    const sendTyping = () => {
      if (isTyping) {
        ctx.sendChatAction("typing").catch(() => {});
      }
    };

    sendTyping();
    const typingInterval = setInterval(sendTyping, 4000);

    try {
      const result = await ask(llm, tools, sessionId, text);

      isTyping = false;
      clearInterval(typingInterval);

      await sendSafeMessage(
        ctx,
        formatTelegramMessage(result)
      );
    } catch (err) {
      isTyping = false;
      clearInterval(typingInterval);

      const msg = err?.message || "Kesalahan internal.";

      console.error(`[TELEGRAM ERROR] ${msg}`);

      await ctx.reply(
        `⚠️ *Terjadi Kesalahan:*\n_${msg}_`,
        { parse_mode: "Markdown" }
      );
    }
  });

  // ==========================================
  // HANDLER: FILE MASUK DARI USER (DOCUMENT)
  // ==========================================
  bot.on(message("document"), async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAllowed(chatId)) return;

    if (!sessions[chatId]) sessions[chatId] = crypto.randomUUID();

    try {
      const document = ctx.message.document;
      const fileId = document.file_id;
      const caption = ctx.message.caption || "";

      // Download file
      const downloadResult = await downloadTelegramFile(ctx, fileId, "document");
      
      if (!downloadResult.success) {
        await ctx.reply(`❌ *Gagal Download File*\n━━━━━━━━━━━━━━━━━━━━\nError: ${downloadResult.error}`);
        return;
      }

      // Process file with AI
      const sessionId = sessions[chatId];
      const { confirmation, analysisPrompt } = await processFileWithAI(
        downloadResult,
        caption,
        sessionId,
        ctx,
        "document"
      );

      // Send confirmation
      await sendSafeMessage(ctx, confirmation);

      // Analyze with AI
      try {
        const result = await ask(llm, tools, sessionId, analysisPrompt);
        if (result && result.trim()) {
          await sendSafeMessage(ctx, formatTelegramMessage(result));
        }
      } catch (err) {
        console.error("[TELEGRAM DOCUMENT AI ERROR]", err.message);
        await ctx.reply(`⚠️ *Error Analisis File*\n━━━━━━━━━━━━━━━━━━━━\n${err.message}\n\nFile tetap tersimpan di: ${downloadResult.filePath}`);
      }

    } catch (err) {
      console.error("[TELEGRAM DOCUMENT ERROR]", err.message);
      await ctx.reply(`⚠️ *Error Memproses Dokumen*\n━━━━━━━━━━━━━━━━━━━━\n${err.message}`);
    }
  });

  // ==========================================
  // HANDLER: PHOTO
  // ==========================================
  bot.on(message("photo"), async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAllowed(chatId)) return;

    if (!sessions[chatId]) sessions[chatId] = crypto.randomUUID();

    try {
      // Get highest resolution photo
      const photos = ctx.message.photo;
      const photo = photos[photos.length - 1]; // Last = highest res
      const fileId = photo.file_id;
      const caption = ctx.message.caption || "";

      // Download file
      const downloadResult = await downloadTelegramFile(ctx, fileId, "photo");
      
      if (!downloadResult.success) {
        await ctx.reply(`❌ *Gagal Download Gambar*\n━━━━━━━━━━━━━━━━━━━━\nError: ${downloadResult.error}`);
        return;
      }

      // Process file with AI
      const sessionId = sessions[chatId];
      const { confirmation, analysisPrompt } = await processFileWithAI(
        downloadResult,
        caption,
        sessionId,
        ctx,
        "photo"
      );

      // Send confirmation
      await sendSafeMessage(ctx, confirmation);

      // Analyze with AI
      try {
        const result = await ask(llm, tools, sessionId, analysisPrompt);
        if (result && result.trim()) {
          await sendSafeMessage(ctx, formatTelegramMessage(result));
        }
      } catch (err) {
        console.error("[TELEGRAM PHOTO AI ERROR]", err.message);
        await ctx.reply(`⚠️ *Error Analisis Gambar*\n━━━━━━━━━━━━━━━━━━━━\n${err.message}\n\nFile tetap tersimpan di: ${downloadResult.filePath}`);
      }

    } catch (err) {
      console.error("[TELEGRAM PHOTO ERROR]", err.message);
      await ctx.reply(`⚠️ *Error Memproses Gambar*\n━━━━━━━━━━━━━━━━━━━━\n${err.message}`);
    }
  });

  // ==========================================
  // HANDLER: VIDEO
  // ==========================================
  bot.on(message("video"), async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAllowed(chatId)) return;

    if (!sessions[chatId]) sessions[chatId] = crypto.randomUUID();

    try {
      const video = ctx.message.video;
      const fileId = video.file_id;
      const caption = ctx.message.caption || "";

      // Download file
      const downloadResult = await downloadTelegramFile(ctx, fileId, "video");
      
      if (!downloadResult.success) {
        await ctx.reply(`❌ *Gagal Download Video*\n━━━━━━━━━━━━━━━━━━━━\nError: ${downloadResult.error}`);
        return;
      }

      // Process file with AI
      const sessionId = sessions[chatId];
      const { confirmation, analysisPrompt } = await processFileWithAI(
        downloadResult,
        caption,
        sessionId,
        ctx,
        "video"
      );

      // Send confirmation
      await sendSafeMessage(ctx, confirmation);

      // Analyze with AI
      try {
        const result = await ask(llm, tools, sessionId, analysisPrompt);
        if (result && result.trim()) {
          await sendSafeMessage(ctx, formatTelegramMessage(result));
        }
      } catch (err) {
        console.error("[TELEGRAM VIDEO AI ERROR]", err.message);
        await ctx.reply(`⚠️ *Error Analisis Video*\n━━━━━━━━━━━━━━━━━━━━\n${err.message}\n\nFile tetap tersimpan di: ${downloadResult.filePath}`);
      }

    } catch (err) {
      console.error("[TELEGRAM VIDEO ERROR]", err.message);
      await ctx.reply(`⚠️ *Error Memproses Video*\n━━━━━━━━━━━━━━━━━━━━\n${err.message}`);
    }
  });

  // ==========================================
  // HANDLER: AUDIO & VOICE
  // ==========================================
  bot.on(message("audio"), async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAllowed(chatId)) return;

    if (!sessions[chatId]) sessions[chatId] = crypto.randomUUID();

    try {
      const audio = ctx.message.audio;
      const fileId = audio.file_id;
      const caption = ctx.message.caption || "";

      // Download file
      const downloadResult = await downloadTelegramFile(ctx, fileId, "audio");
      
      if (!downloadResult.success) {
        await ctx.reply(`❌ *Gagal Download Audio*\n━━━━━━━━━━━━━━━━━━━━\nError: ${downloadResult.error}`);
        return;
      }

      // Process file with AI
      const sessionId = sessions[chatId];
      const { confirmation, analysisPrompt } = await processFileWithAI(
        downloadResult,
        caption,
        sessionId,
        ctx,
        "audio"
      );

      // Send confirmation
      await sendSafeMessage(ctx, confirmation);

      // Analyze with AI
      try {
        const result = await ask(llm, tools, sessionId, analysisPrompt);
        if (result && result.trim()) {
          await sendSafeMessage(ctx, formatTelegramMessage(result));
        }
      } catch (err) {
        console.error("[TELEGRAM AUDIO AI ERROR]", err.message);
        await ctx.reply(`⚠️ *Error Analisis Audio*\n━━━━━━━━━━━━━━━━━━━━\n${err.message}\n\nFile tetap tersimpan di: ${downloadResult.filePath}`);
      }

    } catch (err) {
      console.error("[TELEGRAM AUDIO ERROR]", err.message);
      await ctx.reply(`⚠️ *Error Memproses Audio*\n━━━━━━━━━━━━━━━━━━━━\n${err.message}`);
    }
  });

  // ==========================================
  // HANDLER: VOICE MESSAGE
  // ==========================================
  bot.on(message("voice"), async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isAllowed(chatId)) return;

    if (!sessions[chatId]) sessions[chatId] = crypto.randomUUID();

    try {
      const voice = ctx.message.voice;
      const fileId = voice.file_id;
      const caption = ctx.message.caption || "";

      // Download file
      const downloadResult = await downloadTelegramFile(ctx, fileId, "voice");
      
      if (!downloadResult.success) {
        await ctx.reply(`❌ *Gagal Download Voice*\n━━━━━━━━━━━━━━━━━━━━\nError: ${downloadResult.error}`);
        return;
      }

      // Process file with AI
      const sessionId = sessions[chatId];
      const { confirmation, analysisPrompt } = await processFileWithAI(
        downloadResult,
        caption,
        sessionId,
        ctx,
        "voice"
      );

      // Send confirmation
      await sendSafeMessage(ctx, confirmation);

      // Analyze with AI
      try {
        const result = await ask(llm, tools, sessionId, analysisPrompt);
        if (result && result.trim()) {
          await sendSafeMessage(ctx, formatTelegramMessage(result));
        }
      } catch (err) {
        console.error("[TELEGRAM VOICE AI ERROR]", err.message);
        await ctx.reply(`⚠️ *Error Analisis Voice*\n━━━━━━━━━━━━━━━━━━━━\n${err.message}\n\nFile tetap tersimpan di: ${downloadResult.filePath}`);
      }

    } catch (err) {
      console.error("[TELEGRAM VOICE ERROR]", err.message);
      await ctx.reply(`⚠️ *Error Memproses Voice*\n━━━━━━━━━━━━━━━━━━━━\n${err.message}`);
    }
  });

  // ==========================================
  // ERROR HANDLING & LAUNCH
  // ==========================================
  bot.catch((err) => {
    console.error("\n[TELEGRAM FATAL]", err.message);
    // Don't crash - just log error
  });

  // Graceful error recovery
  let launchAttempts = 0;
  const MAX_LAUNCH_ATTEMPTS = 3;

  async function startBot() {
    try {
      await bot.launch({
        dropPendingUpdates: true,
      });
      console.log("📡 [TELEGRAM] Gateway aktif.");
      launchAttempts = 0;
    } catch (err) {
      console.error("[TELEGRAM LAUNCH ERROR]", err.message);
      if (launchAttempts < MAX_LAUNCH_ATTEMPTS) {
        launchAttempts++;
        console.log(`[TELEGRAM] Retrying launch... (${launchAttempts}/${MAX_LAUNCH_ATTEMPTS})`);
        await new Promise(resolve => setTimeout(resolve, 5000 * launchAttempts));
        startBot();
      } else {
        console.error("[TELEGRAM] Max launch attempts reached. Gateway disabled.");
        bot = null;
      }
    }
  }

  startBot();

  process.once("SIGINT", () => {
    if (bot) bot.stop("SIGINT");
  });
  process.once("SIGTERM", () => {
    if (bot) bot.stop("SIGTERM");
  });
}

// ==========================================
// HELPER EKSPOR: digunakan sendfile tool
// ==========================================
export { sendFile };
