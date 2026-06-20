import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";

import { ChatOpenAI } from "@langchain/openai";
import tools from "../core/tools.js";
import { ask } from "../core/chat.js";
import { handleCommand } from "../core/cmd.js";
import { eventBus } from "../utils/eventBus.js";

function formatTelegramMessage(text) {
  if (!text) return text;
  let formatted = text;
  formatted = formatted.replace(/^### (.*$)/gim, '🔹 *$1*');
  formatted = formatted.replace(/^## (.*$)/gim, '🔸 *$1*');
  formatted = formatted.replace(/^# (.*$)/gim, '🎯 *$1*');
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '*$1*');
  formatted = formatted.replace(/^>\s?(.*$)/gim, '💬 _$1_');
  formatted = formatted.replace(/^- (.*$)/gim, '• $1');
  return formatted;
}

async function sendSafeMessage(target, text, isBot = false, extraOptions = {}) {
  try {
    if (isBot) await target.telegram.sendMessage(extraOptions.chatId, text, { parse_mode: "Markdown" });
    else await target.reply(text, { parse_mode: "Markdown" });
  } catch (e) {
    console.warn("\n[TELEGRAM PARSE WARNING] Format tidak valid, beralih ke teks mentah.");
    if (isBot) await target.telegram.sendMessage(extraOptions.chatId, text);
    else await target.reply(text);
  }
}

const llm = new ChatOpenAI({
  apiKey: process.env.MODEL_API || "ollama",
  model: process.env.MODEL_NAME,
  configuration: { baseURL: process.env.MODEL_URL },
  temperature: 0.2,
  maxTokens: 2048,
}).bindTools(tools, { toolChoice: "auto" });

const token = process.env.TELEGRAM_TOKEN_BOT;

// ==========================================
// EXPORT BOT & SESSIONS AGAR BISA DITARIK SENDFILE.JS
// ==========================================
export const sessions = {};
export let bot = null;

if (!token) {
  console.log("\n[TELEGRAM WARNING] TELEGRAM_TOKEN_BOT tidak ditemukan di .env. Bot dibatalkan.");
} else {
  bot = new Telegraf(token);
  
  const bgLocks = {};

  eventBus.on("execute_bg_task", async ({ job_id, session_id, prompt }) => {
    const chatId = Object.keys(sessions).find(key => sessions[key] === session_id);
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
    } catch (error) { 
      console.error(`[BG TASK ERROR TG] Job ${job_id}:`, error.message); 
    } finally {
      bgLocks[job_id] = false; 
    }
  });

  bot.on(message("text"), async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    if (!sessions[chatId]) sessions[chatId] = crypto.randomUUID();
    
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
    const sendTyping = () => { if (isTyping) ctx.sendChatAction("typing").catch(() => {}); };
    
    sendTyping();
    const typingInterval = setInterval(sendTyping, 4000);

    try {
      const result = await ask(llm, tools, sessionId, text);
      isTyping = false;
      clearInterval(typingInterval);

      const formattedResult = formatTelegramMessage(result);
      await sendSafeMessage(ctx, formattedResult);

    } catch (err) {
      isTyping = false;
      clearInterval(typingInterval);
      const errorMessage = err?.message || err?.error?.message || "Kesalahan internal.";
      console.error(`\n[TELEGRAM ERROR] ${errorMessage}`);
      await ctx.reply(`⚠️ *Terjadi Kesalahan:*\n_${errorMessage}_`, { parse_mode: "Markdown" });
    }
  });

  bot.catch((err) => {
    console.error("\n[TELEGRAM FATAL ERROR]", err);
  });

  bot.launch();
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
