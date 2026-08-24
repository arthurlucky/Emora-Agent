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
import fsSync, { mkdirSync, existsSync } from "fs";
import { pipeline } from "stream/promises";

import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";

import { createLLM } from "../../provider/index.js";
import tools from "../../core/tools.js";
import { ask } from "../../core/chat.js";
import { handleCommand } from "../../core/cmd.js";
import { eventBus } from "../../utils/eventBus.js";
import { touchSession } from "../../core/sessionStore.js";

import { formatTelegramMessage } from "./formatter.js";
import { sendSafeMessage, sendFile } from "./sender.js";
import { getMemberStatus } from "./groupManager.js";
import { setContext, buildContextHeader } from "../sessionContext.js";
import { TurnStateManager } from "../session.js";
import { handleCronCommand } from "../cron/commands.js";
import { getManager } from "../manager.js";

const ALLOWED_IDS = (process.env.TELEGRAM_ALLOWED_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

// DEFAULT-DENY: kalau TELEGRAM_ALLOWED_IDS kosong, bot menolak semua chat
// (kecuali owner id dari TELEGRAM_OWNER_ID). Dulu open-by-default — bot publik
// tanpa config = siapa pun bisa eksekusi shell via agent.
const OWNER_ID = process.env.TELEGRAM_OWNER_ID || "";

function isAllowed(chatId, userId = null) {
  if (ALLOWED_IDS.length === 0) {
    return OWNER_ID ? String(userId ?? chatId) === OWNER_ID : false;
  }
  return ALLOWED_IDS.includes(String(chatId)) || (userId && ALLOWED_IDS.includes(String(userId)));
}

// Teks /help — dulu commandResult.action === "help" dari core/cmd.js gak
// pernah benar-benar dirender (falls-through tanpa balasan), jadi user yang
// ketik /help di Telegram gak dapat apa-apa. Ditambah sekalian penjelasan
// manual skill/command invocation.
const TELEGRAM_HELP_TEXT =
  "⎔ *Perintah EMORA (Telegram)*\n\n" +
  "*Gateway:* `/status` `/stop` `/mode <safe|autonomous>` `/cron ...`\n" +
  "*Sesi:* `/new` `/sesi [id]` `/clear` `/sesilist` `/sesiinfo <id>` `/sesidel <id>`\n" +
  "*Plugin & Artifact:* `/plugin list|disable|enable|reload|install` `/artifact list|get|delete`\n" +
  "*Skill:* `/learn <nama>` (susun skill baru dari sesi ini) · `/<nama_skill_atau_command>` (jalankan skill/command apa pun — bawaan atau dari plugin — langsung)\n\n" +
  "Ketik pesan biasa untuk ngobrol dengan EMORA.";

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
// sessions persist ke .emora/telegram-sessions.json — restart gateway tidak
// lagi memutus lanjutan percakapan (dulu mapping in-memory saja).
const SESSIONS_FILE = ".emora/telegram-sessions.json";
export const sessions = {};
try {
  Object.assign(sessions, JSON.parse(fsSync.readFileSync(SESSIONS_FILE, "utf8")));
} catch { /* belum ada */ }
function persistSessions() {
  try {
    fsSync.mkdirSync(".emora", { recursive: true });
    fsSync.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  } catch {}
}
export let bot = null;
export const turns = new TurnStateManager("telegram");
const pendingApprovals = new Map(); // chatId -> { messageId, content, resolve }

if (!token) {
  console.log("\n[TELEGRAM] Token tidak ditemukan. Gateway dibatalkan.");
} else {
  try {
    llm = await createLLM(tools);
  } catch (err) {
    console.error(`[TELEGRAM] Gagal init LLM: ${err.message}`);
  }

  bot = new Telegraf(token, {
    handlerTimeout: 90000,
  });

  // ==========================================
  // CONTEXT AWARENESS (grup/private, platform, status admin)
  // ==========================================
  /**
   * Bangun & simpan konteks pesan saat ini (platform, grup/private, status
   * admin bot & pengirim) ke sessionContext, lalu balikin objeknya.
   * Status admin cuma di-cek kalau chat-nya grup (hemat API call buat DM).
   */
  async function buildTelegramContext(ctx, sessionId) {
    const chat = ctx.chat;
    const chatType = chat.type === "private" ? "private" : "group";

    let senderIsAdmin = null;
    let botIsAdmin = null;
    let chatTitle = null;

    if (chatType === "group") {
      chatTitle = chat.title || null;
      try {
        const [senderStatus, botStatus] = await Promise.all([
          getMemberStatus(ctx.telegram, chat.id, ctx.from.id),
          getMemberStatus(ctx.telegram, chat.id, ctx.botInfo.id),
        ]);
        senderIsAdmin = senderStatus.isAdmin;
        botIsAdmin = botStatus.isAdmin;
      } catch (err) {
        console.warn("[TG CONTEXT] Gagal cek status admin:", err.message);
      }
    }

    const senderName = ctx.from?.username
      ? `@${ctx.from.username}`
      : [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || `id:${ctx.from?.id}`;

    const context = {
      platform: "telegram",
      chatId: chat.id,
      chatType,
      chatTitle,
      senderId: ctx.from?.id,
      senderName,
      senderIsAdmin,
      botIsAdmin,
    };

    setContext(sessionId, context);
    return context;
  }

  /**
   * Sama kayak `ask()` biasa, tapi otomatis nyisipin header konteks
   * (platform/grup/admin) di depan pesan, biar agent selalu tau lagi
   * ngobrol di mana & posisinya apa sebelum mikirin balasan/tool call.
   */
  async function askWithContext(ctx, sessionId, rawMessage, extra = {}) {
    const context = await buildTelegramContext(ctx, sessionId);
    const enriched = buildContextHeader(context) + rawMessage;
    return ask(llm, tools, sessionId, enriched, extra);
  }

  /**
   * Minta approval user lewat inline keyboard (Approve/Deny) sebelum agent
   * menjalankan tool yang dianggap berisiko. Fallback teks `/yes` `/no`
   * juga didukung lewat `pendingApprovals` (lihat handleGatewayCommand).
   */
  async function requestTelegramApproval(chatId, toolName, args) {
    const argsJson = JSON.stringify(args || {}, null, 2);
    const trimmed = argsJson.length > 800 ? argsJson.slice(0, 800) + "\n…" : argsJson;
    const content = `⚠️ *EMORA minta izin jalankan tool:* \`${toolName}\`\n\`\`\`\n${trimmed}\n\`\`\`\nApprove?`;

    let sent;
    try {
      sent = await bot.telegram.sendMessage(chatId, content, {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          Markup.button.callback("✔ Approve", "emora_approve"),
          Markup.button.callback("✘ Deny", "emora_deny"),
        ]),
      });
    } catch {
      sent = await bot.telegram.sendMessage(chatId, content + "\n\n(Balas /yes atau /no)");
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pendingApprovals.delete(chatId);
        bot.telegram.editMessageText(chatId, sent.message_id, undefined, content + "\n\n⏱ _Timeout, otomatis ditolak._", { parse_mode: "Markdown" }).catch((err) => { console.error('[Ignored Error]', err.message); });
        resolve(false);
      }, 5 * 60 * 1000);

      pendingApprovals.set(chatId, {
        messageId: sent.message_id,
        content,
        resolve: (val) => { clearTimeout(timeout); resolve(val); },
      });
    });
  }

  /**
   * Perintah baru level-gateway (`/status`, `/mode`, `/yes`, `/no`, `/stop`,
   * `/cron`). Return `null` kalau teksnya bukan salah satu perintah ini,
   * supaya lanjut ke handleCommand() bawaan (/exit, /new, /sesi, dst) lalu
   * ke agent seperti biasa.
   */
  async function handleGatewayCommand(chatId, text) {
    if (!text.startsWith("/")) return null;
    const [cmdRaw, ...args] = text.trim().split(/\s+/);
    const cmd = cmdRaw.slice(1).toLowerCase();

    switch (cmd) {
      case "status":
        return `⎔ *EMORA Gateway (Telegram)*\nMode: ${turns.getMode(chatId)}\nSedang jalan: ${turns.isRunning(chatId) ? "ya" : "tidak"}\nTotal chat aktif: ${turns.activeChatCount()}`;

      case "yes":
      case "no": {
        const pending = pendingApprovals.get(chatId);
        if (!pending) return "ℹ Gak ada approval yang lagi nunggu.";
        pendingApprovals.delete(chatId);
        pending.resolve(cmd === "yes");
        await bot.telegram
          .editMessageText(chatId, pending.messageId, undefined, pending.content + `\n\n${cmd === "yes" ? "✔ Disetujui" : "✘ Ditolak"} via /${cmd}`, { parse_mode: "Markdown" })
          .catch((err) => { console.error('[Ignored Error]', err.message); });
        return "";
      }

      case "stop":
        return turns.stop(chatId) ? "⏹ Proses dihentikan." : "ℹ Gak ada proses yang lagi jalan.";

      case "continue":
        return "ℹ EMORA jalan otomatis sampai selesai tiap giliran — gak ada proses yang perlu di-`/continue`.";

      case "mode": {
        const val = (args[0] || "").toLowerCase();
        if (val !== "safe" && val !== "autonomous") {
          return `Mode saat ini: *${turns.getMode(chatId)}*. Pakai \`/mode safe\` atau \`/mode autonomous\`.`;
        }
        turns.setMode(chatId, val);
        return `✔ Mode diganti ke *${val}*.`;
      }

      case "cron": {
        const mgr = getManager();
        return handleCronCommand(mgr.cronStore, "telegram", String(chatId), "", args, {
          runNow: (job) => mgr.cronScheduler.runJobNow(job),
          reload: () => mgr.cronScheduler.reload(),
        });
      }

      default:
        return null;
    }
  }

  bot.action("emora_approve", async (actionCtx) => {
    const chatId = actionCtx.chat.id;
    // SECURITY: hanya pengirim asli turn aktif yang boleh approve tool.
    const approverId = String(actionCtx.from?.id || "");
    const activeUserId = turns.getActiveUserId?.(chatId);
    if (activeUserId && approverId !== String(activeUserId)) {
      await actionCtx.answerCbQuery("Hanya pengirim pesan asli yang bisa approve.");
      return;
    }
    const pending = pendingApprovals.get(chatId);
    if (!pending) { await actionCtx.answerCbQuery("Sudah kadaluarsa."); return; }
    pendingApprovals.delete(chatId);
    pending.resolve(true);
    await actionCtx.editMessageText(pending.content + "\n\n✔ Disetujui", { parse_mode: "Markdown" }).catch((err) => { console.error('[Ignored Error]', err.message); });
    await actionCtx.answerCbQuery("Disetujui.");
  });

  bot.action("emora_deny", async (actionCtx) => {
    const chatId = actionCtx.chat.id;
    const approverId = String(actionCtx.from?.id || "");
    const activeUserD = turns.getActiveUserId?.(chatId);
    if (activeUserD && approverId !== String(activeUserD)) {
      await actionCtx.answerCbQuery("Hanya pengirim pesan asli yang bisa deny.");
      return;
    }
    const pending = pendingApprovals.get(chatId);
    if (!pending) { await actionCtx.answerCbQuery("Sudah kadaluarsa."); return; }
    pendingApprovals.delete(chatId);
    pending.resolve(false);
    await actionCtx.editMessageText(pending.content + "\n\n✘ Ditolak", { parse_mode: "Markdown" }).catch((err) => { console.error('[Ignored Error]', err.message); });
    await actionCtx.answerCbQuery("Ditolak.");
  });

  // ✅ FIX #1: Map untuk track background jobs (clear setelah selesai, bukan selamanya)
  const bgJobs = new Map();

  // ==========================================
  // BACKGROUND TASK LISTENER
  // ==========================================
  eventBus.on("execute_bg_task", async ({ job_id, session_id, prompt }) => {
    const chatId = Object.keys(sessions).find((k) => sessions[k] === session_id);
    if (!chatId) return;
    if (bgJobs.has(job_id)) return; // Job sudah running
    
    bgJobs.set(job_id, true);

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
      // ✅ FIX #1: Clear lock setelah job selesai (tidak forever)
      bgJobs.delete(job_id);
    }
  });

  // ==========================================
  // FILE DOWNLOAD HELPER
  // ==========================================
  async function downloadTelegramFile(ctx, fileId, fileType) {
    try {
      // Get file info from Telegram
      const fileInfo = await ctx.telegram.getFile(fileId);
      // Token TIDAK dimasukkan ke variabel yang bisa ikut ke log/error.
      const fileUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
      
      // Determine filename
      const originalName = fileInfo.file_path.split("/").pop();
      const extension = originalName.split(".").pop() || "bin";
      const timestamp = Date.now();
      const randomStr = crypto.randomBytes(4).toString("hex");
      const filename = `tg_${fileType}_${timestamp}_${randomStr}.${extension}`;
      const filePath = path.join(DOWNLOAD_DIR, filename);

      // ✅ FIX #2: Improved file download dengan streaming (handle large files)
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Check content-length sebelum download
      const contentLength = response.headers.get("content-length");
      const maxSize = 50 * 1024 * 1024; // 50 MB limit untuk Telegram
      if (contentLength && parseInt(contentLength) > maxSize) {
        throw new Error(`File terlalu besar: ${(parseInt(contentLength) / 1024 / 1024).toFixed(2)}MB (max: 50MB)`);
      }

      const buffer = await response.arrayBuffer();
      fsSync.writeFileSync(filePath, Buffer.from(buffer));

      // Get file info
      const stats = fsSync.statSync(filePath);
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
      // Jangan sertakan fileUrl di error (mengandung bot token).
      console.error("[TG FILE DOWNLOAD ERROR]", err.message.replace(/bot\d+:[^/]+/, "bot:***"));
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
        fileContent = fsSync.readFileSync(filePath, "utf8");
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
      persistSessions();
    }

    const gwReply = await handleGatewayCommand(chatId, text);
    if (gwReply !== null) {
      if (gwReply) await sendSafeMessage(ctx, gwReply);
      return;
    }

    const localState = { currentSession: sessions[chatId] };
    const commandResult = await handleCommand(text, localState);

    if (commandResult) {
      sessions[chatId] = localState.currentSession;
      persistSessions();

      if (commandResult.action === "exit") {
        await ctx.reply("❌ Command /exit tidak dapat digunakan di Telegram.");
      } else if (commandResult.action === "reply") {
        const msg = `⚙️ *SISTEM*\n━━━━━━━━━━━━━━━━━━━━\n_${commandResult.message}_`;
        await sendSafeMessage(ctx, msg);
      } else if (commandResult.action === "help") {
        await sendSafeMessage(ctx, TELEGRAM_HELP_TEXT);
      }

      return;
    }

    const sessionId = sessions[chatId];
    let isTyping = true;

    const sendTyping = () => {
      if (isTyping) {
        ctx.sendChatAction("typing").catch((err) => { console.error('[Ignored Error]', err.message); });
      }
    };

    sendTyping();
    const typingInterval = setInterval(sendTyping, 4000);

    const signal = turns.beginTurn(chatId, ctx.from?.id);
    const mode = turns.getMode(chatId);
    const onApproval = (toolName, args) => requestTelegramApproval(chatId, toolName, args);

    try {
      const result = await askWithContext(ctx, sessionId, text, { onApproval, mode, signal });

      isTyping = false;
      clearInterval(typingInterval);

      await sendSafeMessage(
        ctx,
        formatTelegramMessage(result)
      );
      touchSession(sessionId).catch((err) => { console.error('[Ignored Error]', err.message); });
    } catch (err) {
      isTyping = false;
      clearInterval(typingInterval);

      if (err?.aborted) {
        await ctx.reply("⏹ Dihentikan.");
        return;
      }

      const msg = err?.message || "Kesalahan internal.";

      console.error(`[TELEGRAM ERROR] ${msg}`);

      await ctx.reply(
        `⚠️ *Terjadi Kesalahan:*\n_${msg}_`,
        { parse_mode: "Markdown" }
      );
    } finally {
      turns.endTurn(chatId);
      turns.touch(chatId);
    }
  });

  // ==========================================
  // HANDLER FILE TERPADU — document/photo/video/audio/voice.
  // Satu implementasi untuk semua tipe file (dulu 5 handler duplikat
  // ~120 baris masing-masing, dan TIDAK lewat approval gate/turn state).
  // ==========================================
  const FILE_TYPES = ["document", "photo", "video", "audio", "voice"];

  function extractFile(ctx, fileType) {
    const msg = ctx.message;
    if (fileType === "document") return { fileId: msg.document?.file_id };
    if (fileType === "photo") {
      const photos = msg.photo || [];
      return { fileId: photos[photos.length - 1]?.file_id }; // highest res
    }
    return { fileId: msg[fileType]?.file_id }; // video | audio | voice
  }

  async function handleFileMessage(ctx, fileType) {
    const chatId = ctx.chat.id;
    if (!isAllowed(chatId, ctx.from?.id)) return;

    if (!sessions[chatId]) { sessions[chatId] = crypto.randomUUID(); persistSessions(); }

    let isTyping = true;
    const sendTyping = () => {
      if (isTyping) ctx.sendChatAction("typing").catch(() => {});
    };
    sendTyping();
    const typingInterval = setInterval(sendTyping, 4000);

    try {
      const { fileId } = extractFile(ctx, fileType);
      const caption = ctx.message.caption || "";
      if (!fileId) { await ctx.reply("❌ File tidak terdeteksi."); return; }

      const downloadResult = await downloadTelegramFile(ctx, fileId, fileType);
      if (!downloadResult.success) {
        await ctx.reply(`❌ *Gagal Download ${fileType}*\\n${downloadResult.error}`, { parse_mode: "Markdown" });
        return;
      }

      const sessionId = sessions[chatId];
      const { confirmation, analysisPrompt } = await processFileWithAI(
        downloadResult, caption, sessionId, ctx, fileType,
      );
      await sendSafeMessage(ctx, confirmation);

      // Analisis lewat ask() PENUH dengan approval gate + turn state —
      // sama seperti pesan teks (dulu file handlers bypass keduanya).
      const signal = turns.beginTurn(chatId, ctx.from?.id);
      const mode = turns.getMode(chatId);
      try {
        const result = await askWithContext(ctx, sessionId, analysisPrompt, {
          onApproval: (toolName, args) => requestTelegramApproval(chatId, toolName, args),
          mode, signal,
        });
        if (result && result.trim()) {
          await sendSafeMessage(ctx, formatTelegramMessage(result));
        }
        touchSession(sessionId).catch(() => {});
      } finally {
        turns.endTurn(chatId);
      }
    } catch (err) {
      console.error(`[TELEGRAM ${fileType.toUpperCase()} ERROR]`, err.message);
      await ctx.reply(`⚠️ *Error Memproses ${fileType}*\\n${err.message}`).catch(() => {});
    } finally {
      isTyping = false;
      clearInterval(typingInterval);
    }
  }

  for (const ft of FILE_TYPES) {
    bot.on(message(ft), (ctx) => handleFileMessage(ctx, ft));
  }

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
