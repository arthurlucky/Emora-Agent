import fs from "fs";
import path from "path";
import { resolveWorkspacePath } from "../utils/workspace.js";

export async function handleSendFile(command, sessionId) {
  try {
    // Regex cerdas untuk mengambil argumen (mendukung tanda kutip ganda atau tunggal)
    const pathMatch = command.match(/--pathfile=["']?([^"'\s]+)["']?/);
    const textMatch = command.match(/--text=["']([^"']+)["']/);

    if (!pathMatch) {
      return "❌ Error: Format salah. Gunakan: sendFile --pathfile=\"./namafile.txt\" --text=\"Caption\"";
    }

    const rawPath = pathMatch[1];
    const caption = textMatch ? textMatch[1] : "";

    // Memastikan path aman dan ada di dalam workspace
    const absolutePath = resolveWorkspacePath(rawPath);

    if (!fs.existsSync(absolutePath)) {
      return `❌ Error: File tidak ditemukan di '${rawPath}'. Pastikan kamu sudah membuatnya sebelum mengirim!`;
    }

    // ===============================================
    // CEK UKURAN FILE (ANTI SOCKET HANG UP)
    // ===============================================
    const stats = fs.statSync(absolutePath);
    const fileSizeInMB = stats.size / (1024 * 1024);

    if (stats.size === 0) {
      return `❌ Error: File '${rawPath}' ukurannya 0 byte (kosong). Tolong isi file tersebut dengan teks/kode terlebih dahulu karena Telegram menolak file kosong!`;
    }

    if (fileSizeInMB > 50) {
      return `❌ Error: Ukuran file ${fileSizeInMB.toFixed(2)} MB. Batas maksimal pengiriman Telegram Bot adalah 50 MB.`;
    }
    // ===============================================

    // TARIK BOT LANGSUNG DARI TELEGRAM (Dynamic Import anti-crash)
    const { bot, sessions } = await import("./telegram.js");

    if (!bot) {
      return "❌ Error: Telegram gateway sedang tidak aktif. File tidak bisa dikirim.";
    }

    // Cari Chat ID berdasarkan session_id user
    const chatId = Object.keys(sessions).find(key => sessions[key] === sessionId);
    if (!chatId) {
      return "❌ Error: Sesi Telegram tidak ditemukan (User belum memulai chat).";
    }

    const ext = path.extname(absolutePath).toLowerCase();
    const fileName = path.basename(absolutePath);
    const finalCaption = caption ? caption : `📎 *File:* \`${fileName}\``;

    console.log(`[TELEGRAM API] 🚀 Mengirim file langsung via Bot API: ${absolutePath}`);

    // Eksekusi API Bot langsung
    if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) {
      await bot.telegram.sendPhoto(
        chatId, 
        { source: absolutePath }, 
        { caption: finalCaption, parse_mode: "Markdown" }
      );
    } else {
      await bot.telegram.sendDocument(
        chatId, 
        { source: absolutePath }, 
        { caption: finalCaption, parse_mode: "Markdown" }
      );
    }

    return `✅ Perintah eksekusi berhasil! File '${fileName}' telah dikirim ke Telegram pengguna secara langsung.`;
  } catch (err) {
    return `❌ Error eksekusi sendFile: ${err.message}`;
  }
}
