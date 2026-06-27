/**
 * receiver.js
 * Menangani penerimaan file yang dikirim user ke WhatsApp bot.
 * File yang diterima disimpan ke folder uploads/.
 *
 * Kompatibel dengan @whiskeysockets/baileys (bukan whatsapp-web.js).
 *
 * Tipe yang didukung:
 *  - image      → .jpg, .png, .webp, .gif
 *  - video      → .mp4, .mkv, dll.
 *  - audio      → .mp3, .ogg, .wav
 *  - document   → semua tipe dokumen (.pdf, .txt, .zip, dll.)
 *  - sticker    → .webp
 */

import fs   from 'fs'
import path from 'path'
import { downloadContentFromMessage, getContentType } from '@whiskeysockets/baileys'

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads')
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })

/** Map mime type → ekstensi file default */
const MIME_TO_EXT = {
  'image/jpeg'              : '.jpg',
  'image/png'               : '.png',
  'image/webp'              : '.webp',
  'image/gif'               : '.gif',
  'video/mp4'               : '.mp4',
  'audio/ogg; codecs=opus'  : '.ogg',
  'audio/mpeg'              : '.mp3',
  'application/pdf'         : '.pdf',
  'application/zip'         : '.zip',
  'application/x-zip-compressed': '.zip',
  'text/plain'              : '.txt',
}

/** Tipe Baileys yang mengandung media */
const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage']

/**
 * Handler utama untuk file yang diterima dari user WhatsApp.
 * Dipanggil dari handler.js ketika pesan mengandung media.
 *
 * @param {object} m    - Message object Baileys (raw proto)
 * @param {object} sock - Socket Baileys (makeWASocket instance)
 * @returns {Promise<string|null>}
 */
export async function handleIncomingFile(m, sock) {
  const mtype = getContentType(m.message)
  if (!MEDIA_TYPES.includes(mtype)) return null

  const mediaMsg = m.message[mtype]
  if (!mediaMsg) return null

  try {
    // Tentukan tipe download yang sesuai
    const typeMap = {
      imageMessage   : 'image',
      videoMessage   : 'video',
      audioMessage   : 'audio',
      documentMessage: 'document',
      stickerMessage : 'sticker',
    }
    const dlType = typeMap[mtype] || 'document'

    // Download media sebagai stream lalu kumpulkan ke buffer
    const stream = await downloadContentFromMessage(mediaMsg, dlType)
    let buffer = Buffer.from([])
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk])
    }

    // Tentukan ekstensi
    const mime  = mediaMsg.mimetype || ''
    const ext   = MIME_TO_EXT[mime] || path.extname(mediaMsg.fileName || '') || '.bin'

    const baseName = mediaMsg.fileName
      ? mediaMsg.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
      : `wa_file_${Date.now()}${ext}`

    const safeName = `${Date.now()}_${baseName}`
    const destPath = path.join(UPLOADS_DIR, safeName)

    fs.writeFileSync(destPath, buffer)

    const sizeKB  = (buffer.length / 1024).toFixed(1)
    const fileExt = path.extname(safeName).toLowerCase()
    const zipNote = fileExt === '.zip'
      ? '\n📦 *File ZIP terdeteksi.* Beritahu saya jika ingin saya ekstrak isinya.'
      : ''

    return (
      `✅ *File diterima!*\n` +
      `📄 Nama: \`${safeName}\`\n` +
      `📦 Ukuran: ${sizeKB} KB\n` +
      `📁 Disimpan di: \`uploads/${safeName}\`` +
      zipNote
    )
  } catch (err) {
    console.error('[WA RECEIVER ERROR]', err.message)
    return `❌ Gagal menerima file: ${err.message}`
  }
}
