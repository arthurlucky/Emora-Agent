/**
 * receiver.js
 * Menangani penerimaan file yang dikirim user ke bot Telegram.
 * File yang diterima disimpan ke folder uploads/.
 *
 * Tipe yang didukung:
 *  - document  → semua tipe file (.txt, .pdf, .zip, .js, dll.)
 *  - photo     → gambar (diambil ukuran terbesar)
 *  - video     → file video
 *  - audio     → file audio
 *
 * Untuk file .zip:
 *  - Disimpan apa adanya ke uploads/
 *  - EMORA (via AGENT.md) yang menentukan apakah perlu di-extract
 */

import fs from "fs";
import path from "path";
import https from "https";
import http from "http";

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

/** Pastikan folder uploads/ selalu ada */
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * Download file dari URL ke path lokal.
 * @param {string} url
 * @param {string} destPath
 * @returns {Promise<void>}
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(destPath);
    protocol.get(url, (res) => {
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

/**
 * Ambil info file dari update Telegram.
 * @param {object} ctx - Telegraf context
 * @returns {{ fileId: string, fileName: string, mimeType: string } | null}
 */
function extractFileInfo(ctx) {
  const msg = ctx.message;

  if (msg.document) {
    return {
      fileId: msg.document.file_id,
      fileName: msg.document.file_name || `file_${Date.now()}`,
      mimeType: msg.document.mime_type || "application/octet-stream",
    };
  }

  if (msg.photo) {
    // Ambil foto resolusi tertinggi (elemen terakhir)
    const photo = msg.photo[msg.photo.length - 1];
    return {
      fileId: photo.file_id,
      fileName: `photo_${Date.now()}.jpg`,
      mimeType: "image/jpeg",
    };
  }

  if (msg.video) {
    return {
      fileId: msg.video.file_id,
      fileName: msg.video.file_name || `video_${Date.now()}.mp4`,
      mimeType: msg.video.mime_type || "video/mp4",
    };
  }

  if (msg.audio) {
    return {
      fileId: msg.audio.file_id,
      fileName: msg.audio.file_name || `audio_${Date.now()}.mp3`,
      mimeType: msg.audio.mime_type || "audio/mpeg",
    };
  }

  return null;
}

/**
 * Handler utama untuk file yang diterima dari user.
 * Dipanggil dari bot.on('message') di telegram.js.
 *
 * @param {object} ctx      - Telegraf context
 * @param {string} token    - TELEGRAM_TOKEN_BOT dari .env
 * @returns {Promise<string>} - Pesan konfirmasi atau error
 */
export async function handleIncomingFile(ctx, token) {
  const fileInfo = extractFileInfo(ctx);

  if (!fileInfo) {
    return null; // Bukan file, lewati
  }

  try {
    // Dapatkan URL download dari Telegram
    const tgFile = await ctx.telegram.getFile(fileInfo.fileId);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${tgFile.file_path}`;

    // Hindari nama file duplikat dengan prefix timestamp
    const timestamp = Date.now();
    const safeName = fileInfo.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const destPath = path.join(UPLOADS_DIR, `${timestamp}_${safeName}`);

    console.log(`[TELEGRAM RECEIVER] Mengunduh file: ${fileInfo.fileName}`);
    await downloadFile(fileUrl, destPath);

    const ext = path.extname(safeName).toLowerCase();
    const sizeKB = (fs.statSync(destPath).size / 1024).toFixed(1);

    // Beri info tambahan untuk .zip agar EMORA tahu
    const zipNote =
      ext === ".zip"
        ? "\n📦 *File ZIP terdeteksi.* Beritahu saya jika ingin saya ekstrak isinya."
        : "";

    return (
      `✅ *File diterima!*\n` +
      `📄 Nama: \`${safeName}\`\n` +
      `📦 Ukuran: ${sizeKB} KB\n` +
      `📁 Disimpan di: \`uploads/${timestamp}_${safeName}\`` +
      zipNote
    );
  } catch (err) {
    console.error("[TELEGRAM RECEIVER ERROR]", err.message);
    return `❌ Gagal menerima file: ${err.message}`;
  }
}
