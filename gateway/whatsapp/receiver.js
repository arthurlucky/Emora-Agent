/**
 * receiver.js
 * Menangani penerimaan file yang dikirim user ke WhatsApp bot.
 * File yang diterima disimpan ke folder uploads/.
 *
 * Tipe yang didukung:
 *  - image      → .jpg, .png, .webp, .gif
 *  - video      → .mp4, .mkv, dll.
 *  - audio      → .mp3, .ogg, .wav
 *  - document   → semua tipe dokumen (.pdf, .txt, .zip, dll.)
 *  - sticker    → .webp
 *
 * Untuk file .zip:
 *  - Disimpan apa adanya ke uploads/
 *  - EMORA (via AGENT.md) yang menentukan apakah perlu di-extract
 */

import fs from "fs";
import path from "path";

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/** Map mime type → ekstensi file default */
const MIME_TO_EXT = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "audio/ogg; codecs=opus": ".ogg",
  "audio/mpeg": ".mp3",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "application/x-zip-compressed": ".zip",
  "text/plain": ".txt",
};

/**
 * Handler utama untuk file yang diterima dari user WhatsApp.
 * Dipanggil dari client.on('message') di whatsapp.js.
 *
 * @param {object} msg       - Message object dari whatsapp-web.js
 * @param {object} waClient  - Client instance (tidak dipakai, untuk konsistensi API)
 * @returns {Promise<string|null>}
 */
export async function handleIncomingFile(msg, waClient) {
  if (!msg.hasMedia) return null;

  try {
    const media = await msg.downloadMedia();

    if (!media || !media.data) {
      return "❌ Gagal mengunduh media dari WhatsApp.";
    }

    // Tentukan ekstensi file
    const ext = MIME_TO_EXT[media.mimetype] || path.extname(media.filename || "") || ".bin";
    const baseName = media.filename
      ? media.filename.replace(/[^a-zA-Z0-9._-]/g, "_")
      : `wa_file_${Date.now()}${ext}`;

    const timestamp = Date.now();
    const safeName = `${timestamp}_${baseName}`;
    const destPath = path.join(UPLOADS_DIR, safeName);

    // Decode base64 dan simpan ke disk
    const buffer = Buffer.from(media.data, "base64");
    fs.writeFileSync(destPath, buffer);

    const sizeKB = (buffer.length / 1024).toFixed(1);
    const fileExt = path.extname(safeName).toLowerCase();

    const zipNote =
      fileExt === ".zip"
        ? "\n📦 *File ZIP terdeteksi.* Beritahu saya jika ingin saya ekstrak isinya."
        : "";

    return (
      `✅ *File diterima!*\n` +
      `📄 Nama: \`${safeName}\`\n` +
      `📦 Ukuran: ${sizeKB} KB\n` +
      `📁 Disimpan di: \`uploads/${safeName}\`` +
      zipNote
    );
  } catch (err) {
    console.error("[WA RECEIVER ERROR]", err.message);
    return `❌ Gagal menerima file: ${err.message}`;
  }
}
