/**
 * sender.js
 * Fungsi pengiriman file ke pengguna WhatsApp.
 *
 * Diperbarui untuk menggunakan @whiskeysockets/baileys.
 */

import fs from "fs";
import path from "path";

/**
 * Kirim file ke pengguna WhatsApp.
 *
 * @param {object} waClient    - Instance socket Baileys (makeWASocket)
 * @param {string} chatId      - Chat ID tujuan (format: 628xxx@s.whatsapp.net)
 * @param {string} filePath    - Path absolut ke file
 * @param {string} caption     - Caption opsional
 * @returns {Promise<string>}
 */
export async function sendFile(waClient, chatId, filePath, caption = "") {
  if (!fs.existsSync(filePath)) {
    return `❌ File tidak ditemukan: ${filePath}`;
  }

  const stats = fs.statSync(filePath);

  if (stats.size === 0) {
    return `❌ File kosong (0 byte): ${path.basename(filePath)}`;
  }

  const fileSizeMB = stats.size / (1024 * 1024);

  // Batas standar pengiriman dokumen/media di WhatsApp (umumnya 64MB - 100MB)
  if (fileSizeMB > 64) {
    return `❌ Ukuran file ${fileSizeMB.toFixed(2)} MB melebihi batas 64 MB WhatsApp.`;
  }

  try {
    const fileName = path.basename(filePath);
    const finalCaption = caption || `📎 *File:* \`${fileName}\``;

    // Baileys dapat membaca file langsung dari path menggunakan properti 'url'.
    // Menggunakan 'document' menjaga nama file dan menghindari kompresi otomatis.
    await waClient.sendMessage(chatId, {
      document: { url: filePath },
      fileName: fileName,
      caption: finalCaption,
    });

    return `✅ File '${fileName}' berhasil dikirim via WhatsApp.`;
  } catch (err) {
    return `❌ Gagal mengirim file via WhatsApp: ${err.message}`;
  }
}
