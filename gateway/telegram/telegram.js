/**
 * telegram.js
 * Gateway utama Telegram.
 * Menggabungkan: formatter, sender, receiver, dan core chat/cmd.
 */

import "dotenv/config";
import crypto from "crypto";

import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";

import { ChatOpenAI } from "@langchain/openai";
import tools from "../../core/tools.js";
import { ask } from "../../core/chat.js";
import { handleCommand } from "../../core/cmd.js";
import { eventBus } from "../../utils/eventBus.js";

import { formatTelegramMessage } from "./formatter.js";
import { sendSafeMessage, sendFile } from "./sender.js";
import { handleIncomingFile } from "./receiver.js";
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
// LLM
// ==========================================
const llm = new ChatOpenAI({
  apiKey: process.env.MODEL_API || "ollama",
  model: process.env.MODEL_NAME,
  configuration: { baseURL: process.env.MODEL_URL },
  temperature: 0.2,
  maxTokens: 2048,
}).bindTools(tools, { toolChoice: "auto" });

const token = process.env.TELEGRAM_TOKEN_BOT;

// ==========================================
// EXPORT sessions & bot (digunakan sender.js via sendfile tool)
// ==========================================
export const sessions = {};
export let bot = null;

if (!token) {
  console.log("\n[TELEGRAM] Token tidak ditemukan. Gateway dibatalkan.");
} else {
  bot = new Telegraf(token);
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
  // HANDLER: FILE MASUK DARI USER
  // ==========================================
  const FILE_FILTER = message("document");
  const PHOTO_FILTER = message("photo");
  const VIDEO_FILTER = message("video");
  const AUDIO_FILTER = message("audio");

  async function fileHandler(ctx) {
    const chatId = ctx.chat.id;
    if (!sessions[chatId]) sessions[chatId] = crypto.randomUUID();

    const confirmation = await handleIncomingFile(ctx, token);
    if (confirmation) {
      await sendSafeMessage(ctx, confirmation);

      // Teruskan ke AI agar EMORA tahu ada file masuk
      const sessionId = sessions[chatId];
      const caption = ctx.message.caption || "";
      const prompt = `[FILE DITERIMA] ${confirmation}${caption ? `\nPesan user: ${caption}` : ""}`;

      try {
        const result = await ask(llm, tools, sessionId, prompt);
        if (result && result.trim()) {
          await sendSafeMessage(ctx, formatTelegramMessage(result));
        }
      } catch (err) {
        console.error("[TELEGRAM FILE HANDLER ERROR]", err.message);
      }
    }
  }

  bot.on(FILE_FILTER, fileHandler);
  bot.on(PHOTO_FILTER, fileHandler);
  bot.on(VIDEO_FILTER, fileHandler);
  bot.on(AUDIO_FILTER, fileHandler);

  // ==========================================
  // LAUNCH
  // ==========================================
  bot.catch((err) => {
    console.error("\n[TELEGRAM FATAL]", err);
  });

  bot.launch();
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));

  console.log("📡 [TELEGRAM] Gateway aktif.");
}

// ==========================================
// HELPER EKSPOR: digunakan sendfile tool
// ==========================================
export { sendFile };
