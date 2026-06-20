/**
 * sendfile.js
 * Tool handler untuk perintah sendFile yang dipanggil oleh shell_exec.
 * Menggunakan sender.js untuk pengiriman aktual ke Telegram.
 *
 * Format perintah:
 *   sendFile --pathfile="./namafile.txt" --text="Caption opsional"
 */

import fs from "fs";
import { resolveWorkspacePath } from "../../utils/workspace.js";

/**
 * @param {string} command   - Raw command string dari shell_exec
 * @param {string} sessionId - Session ID user yang aktif
 * @returns {Promise<string>}
 */
export async function handleSendFile(command, sessionId) {
  try {
    const pathMatch = command.match(/--pathfile=["']?([^"'\s]+)["']?/);
    const textMatch = command.match(/--text=["']([^"']+)["']/);

    if (!pathMatch) {
      return '❌ Format salah. Gunakan: sendFile --pathfile="./namafile.txt" --text="Caption"';
    }

    const rawPath = pathMatch[1];
    const caption = textMatch ? textMatch[1] : "";
    const absolutePath = resolveWorkspacePath(rawPath);

    if (!fs.existsSync(absolutePath)) {
      return `❌ File tidak ditemukan: '${rawPath}'`;
    }

    // Dynamic import agar tidak crash jika gateway belum aktif
    const { bot, sessions, sendFile } = await import("./telegram.js");

    if (!bot) {
      return "❌ Telegram gateway tidak aktif. File tidak bisa dikirim.";
    }

    const chatId = Object.keys(sessions).find((k) => sessions[k] === sessionId);
    if (!chatId) {
      return "❌ Sesi Telegram tidak ditemukan. User belum memulai chat.";
    }

    return await sendFile(bot, chatId, absolutePath, caption);
  } catch (err) {
    return `❌ Error sendFile: ${err.message}`;
  }
}
