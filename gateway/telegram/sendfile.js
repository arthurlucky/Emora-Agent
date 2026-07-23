/**
 * sendfile.js
 * Tool handler untuk perintah sendFile yang dipanggil oleh shell_exec.
 * Menggunakan sender.js untuk pengiriman aktual ke Telegram.
 *
 * Format perintah:
 *   sendFile --pathfile="./namafile.txt" --text="Caption opsional"
 * 
 * ✅ FIX #4: Improved path parsing dengan proper quote handling
 */

import fs from "fs";
import { resolveWorkspacePath } from "../../utils/workspace.js";

/**
 * Parse value dari format --key="value" atau --key='value' atau --key=value
 * Handle spasi dalam path dengan quote
 * @param {string} command - Raw command string
 * @param {string} key - Parameter key (tanpa --)
 * @returns {string|null}
 */
function parseParameter(command, key) {
  // Match: --key="value" or --key='value' or --key=value
  const regexQuoted = new RegExp(`--${key}=["']([^"']+)["']`);
  const regexUnquoted = new RegExp(`--${key}=([^\\s]+)`);
  
  let match = command.match(regexQuoted);
  if (match) return match[1];
  
  match = command.match(regexUnquoted);
  if (match) return match[1];
  
  return null;
}

/**
 * @param {string} command   - Raw command string dari shell_exec
 * @param {string} sessionId - Session ID user yang aktif
 * @returns {Promise<string>}
 */
export async function handleSendFile(command, sessionId) {
  try {
    // ✅ FIX #4: Improved parsing untuk handle spasi dalam path
    const rawPath = parseParameter(command, "pathfile");
    const caption = parseParameter(command, "text") || "";

    if (!rawPath) {
      return '❌ Format salah. Gunakan: sendFile --pathfile="./namafile.txt" --text="Caption"';
    }

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
