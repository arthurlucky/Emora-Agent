/**
 * sender.js
 * Fungsi pengiriman pesan & file ke Telegram, dengan fallback aman.
 */

import fs from "fs";
import path from "path";

/**
 * Kirim pesan teks dengan Markdown, fallback ke plain text jika gagal.
 * @param {object} target - ctx (dari handler) atau bot instance
 * @param {string} text
 * @param {boolean} isBot - true jika mengirim via bot.telegram.sendMessage
 * @param {object} extraOptions - { chatId } jika isBot = true
 */
export async function sendSafeMessage(target, text, isBot = false, extraOptions = {}) {
  try {
    if (isBot) {
      await target.telegram.sendMessage(extraOptions.chatId, text, { parse_mode: "Markdown" });
    } else {
      await target.reply(text, { parse_mode: "Markdown" });
    }
  } catch {
    console.warn("\n[TELEGRAM] Format Markdown tidak valid, beralih ke teks mentah.");
    if (isBot) {
      await target.telegram.sendMessage(extraOptions.chatId, text);
    } else {
      await target.reply(text);
    }
  }
}

/**
 * Kirim file ke pengguna Telegram.
 * - Gambar  (.png, .jpg, .jpeg, .gif, .webp) → sendPhoto
 * - Lainnya                                   → sendDocument
 *
 * @param {object} bot        - Telegraf bot instance
 * @param {string|number} chatId
 * @param {string} filePath   - Path absolut ke file
 * @param {string} caption    - Caption opsional
 * @returns {Promise<string>} - Pesan hasil
 */
export async function sendFile(bot, chatId, filePath, caption = "") {
  if (!fs.existsSync(filePath)) {
    return `❌ File tidak ditemukan: ${filePath}`;
  }

  const stats = fs.statSync(filePath);

  if (stats.size === 0) {
    return `❌ File kosong (0 byte): ${path.basename(filePath)}`;
  }

  const fileSizeMB = stats.size / (1024 * 1024);
  if (fileSizeMB > 50) {
    return `❌ Ukuran file ${fileSizeMB.toFixed(2)} MB melebihi batas 50 MB Telegram.`;
  }

  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);
  const finalCaption = caption || `📎 *File:* \`${fileName}\``;

  const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];

  try {
    if (IMAGE_EXTS.includes(ext)) {
      await bot.telegram.sendPhoto(chatId, { source: filePath }, { caption: finalCaption, parse_mode: "Markdown" });
    } else {
      await bot.telegram.sendDocument(chatId, { source: filePath }, { caption: finalCaption, parse_mode: "Markdown" });
    }
    return `✅ File '${fileName}' berhasil dikirim ke pengguna.`;
  } catch (err) {
    return `❌ Gagal mengirim file: ${err.message}`;
  }
}
