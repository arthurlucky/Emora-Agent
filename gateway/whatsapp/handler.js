import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { getContentType } from '@whiskeysockets/baileys';
import {
  downloadMediaMessage
} from '@whiskeysockets/baileys';

import { createLLM } from '../../provider/index.js';
import tools from '../../core/tools.js';
import { ask } from '../../core/chat.js';
import { handleCommand } from '../../core/cmd.js';
import { eventBus } from '../../utils/eventBus.js';
import { setContext, buildContextHeader } from '../sessionContext.js';
import { sendFile, sendText } from './sender.js';
import { formatWhatsAppMessage } from './formatter.js';

export const sessions = {};
export let client = null;

export function setClient(sock) {
  client = sock;
}

const DOWNLOAD_DIR = './downloads/whatsapp';
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

async function downloadWhatsAppFile(m, messageType) {
  try {
    const mediaMessage = m.message[messageType];
    const mimeType = mediaMessage.mimetype || 'application/octet-stream';
    const extension = mimeType.split('/')[1]?.split(';')[0] || 'bin';
    const timestamp = Date.now();
    const randomStr = crypto.randomBytes(4).toString('hex');
    const filename = `wa_${timestamp}_${randomStr}.${extension}`;
    const filePath = path.join(DOWNLOAD_DIR, filename);

    const buffer = await downloadMediaMessage(
      m,
      'buffer',
      {},
      {
        logger: pino({ level: 'silent' }),
        reuploadRequest: client?.updateMediaMessage
      }
    );

    if (!buffer) throw new Error('empty buffer');
    fs.writeFileSync(filePath, buffer);
    const stats = fs.statSync(filePath);
    const sizeKB = (stats.size / 1024).toFixed(2);

    return {
      success: true,
      filePath,
      filename,
      mimeType,
      size: sizeKB,
      extension
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function buildMediaPrompt(fileInfo, caption) {
  const { filename, mimeType, size, extension, filePath } = fileInfo;
  const isImage = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');
  const isAudio = mimeType.startsWith('audio/');
  const isPDF = extension === 'pdf' || mimeType === 'application/pdf';
  const isDoc = mimeType.startsWith('application/') || mimeType.startsWith('text/');

  let prompt = '';
  const cap = caption ? `Caption: "${caption}"` : 'Tidak ada caption.';

  if (isImage) {
    prompt = `User mengirim gambar: "${filename}" (${size}KB). ${cap}\n\nAnalisis gambar ini. Jika user meminta sesuatu terkait gambar (edit, describe, analyze, extract text, dll), lakukan sesuai permintaan. Jika tidak ada permintaan spesifik, berikan deskripsi umum gambar tersebut.`;
  } else if (isVideo) {
    prompt = `User mengirim video: "${filename}" (${size}KB). ${cap}\n\nAnalisis video ini. Jika user meminta sesuatu terkait video (extract frames, describe, summarize, dll), lakukan sesuai permintaan.`;
  } else if (isAudio) {
    prompt = `User mengirim audio: "${filename}" (${size}KB). ${cap}\n\nAnalisis audio ini. Jika user meminta transkripsi, summary, atau analisis audio, lakukan sesuai permintaan.`;
  } else if (isPDF) {
    prompt = `User mengirim file PDF: "${filename}" (${size}KB). ${cap}\n\nBaca dan analisis konten PDF ini. Jika user meminta summary, extract text, atau analisis spesifik, lakukan sesuai permintaan.`;
  } else if (isDoc) {
    prompt = `User mengirim dokumen: "${filename}" (${size}KB, type: ${mimeType}). ${cap}\n\nAnalisis dokumen ini. Jika user meminta extract text, summary, convert, atau manipulasi file, lakukan sesuai permintaan.`;
  } else {
    prompt = `User mengirim file: "${filename}" (${size}KB, type: ${mimeType}). ${cap}\n\nFile telah disimpan di: ${filePath}\n\nJika user meminta sesuatu terkait file ini (baca, convert, analyze, dll), lakukan sesuai permintaan.`;
  }

  if (mimeType.startsWith('text/') || extension === 'txt' || extension === 'md' || extension === 'json' || extension === 'csv') {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const truncated = content.length > 10000 ? content.substring(0, 10000) + '\n... [truncated]' : content;
      prompt += `\n\nKonten file:\n\`\`\`\n${truncated}\n\`\`\``;
    } catch (_) {}
  }
  return prompt;
}

let llm;
try {
  llm = await createLLM(tools);
} catch (_) {
  console.error('[WA] LLM init failed');
}

async function askWithContext(sessionId, contextHeader, rawMessage) {
  const enriched = contextHeader ? `${contextHeader}\n${rawMessage}` : rawMessage;
  return ask(llm, tools, sessionId, enriched);
}

const bgLocks = {};
eventBus.on('execute_bg_task', async ({ job_id, session_id, prompt }) => {
  if (bgLocks[job_id]) return;
  bgLocks[job_id] = true;
  try {
    const bgSess = `${session_id}_bg_${job_id}`;
    const result = await ask(llm, tools, bgSess, `[BACKGROUND TASK] ${prompt}`);
    if (!result.includes('SILENT_ABORT') && client) {
      const chatId = Object.keys(sessions).find(k => sessions[k] === session_id);
      if (chatId) await client.sendMessage(chatId, { text: formatWhatsAppMessage(result) });
    }
  } catch (e) {
    console.error('[WA BG]', e.message);
  } finally {
    bgLocks[job_id] = false;
  }
});

async function buildContextAndEnrich(sock, sessionId, m) {
  const isGroup = m.isGroup;
  let groupAdmins = [];
  let groupName = '';
  let senderIsAdmin = false;
  let botIsAdmin = false;
  const botJid = sock.decodeJid(sock.user.id);

  if (isGroup) {
    const meta = await sock.groupMetadata(m.chat);
    groupName = meta.subject || '';
    const participants = meta.participants || [];
    groupAdmins = participants.filter(p => p.admin).map(p => p.jid || p.id);
    senderIsAdmin = groupAdmins.includes(m.sender);
    botIsAdmin = groupAdmins.includes(botJid);
  }

  const ctx = {
    platform: 'whatsapp',
    chatId: m.chat,
    chatType: isGroup ? 'group' : 'private',
    chatTitle: groupName || null,
    senderId: m.sender,
    senderName: m.pushName || m.sender.split('@')[0],
    senderIsAdmin,
    botIsAdmin,
  };

  setContext(sessionId, ctx);
  return buildContextHeader(ctx);
}

export const handler = async (sock, m) => {
  if (!m.message || m.key.fromMe) return;

  m.mtype = getContentType(m.message);
  if (['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2'].includes(m.mtype)) {
    m.message = m.message[m.mtype].message;
    m.mtype = getContentType(m.message);
  }

  if (m.mtype === 'interactiveResponseMessage' || m.message?.interactiveResponseMessage) {
    try {
      const ir = m.message.interactiveResponseMessage || m.message[m.mtype];
      m.body = JSON.parse(ir.nativeFlowResponseMessage.paramsJson).id;
    } catch {
      m.body = '';
    }
  } else {
    m.body =
      m.mtype === 'conversation'               ? m.message.conversation :
      m.mtype === 'imageMessage'               ? m.message.imageMessage?.caption :
      m.mtype === 'videoMessage'               ? m.message.videoMessage?.caption :
      m.mtype === 'extendedTextMessage'        ? m.message.extendedTextMessage?.text :
      m.mtype === 'buttonsResponseMessage'     ? m.message.buttonsResponseMessage?.selectedButtonId :
      m.mtype === 'listResponseMessage'        ? m.message.listResponseMessage?.singleSelectReply?.selectedRowId :
      m.mtype === 'templateButtonReplyMessage' ? m.message.templateButtonReplyMessage?.selectedId :
      '';
  }

  const jid = m.key.remoteJid;
  if (!jid) return;

  const isGroup = jid.endsWith('@g.us');
  const sender = isGroup ? m.key.participant : jid;
  const number = sender?.split('@')[0] || '-';
  const pushname = m.pushName || 'Unknown';
  const isOwner = global.owner?.includes(number) || global.lidowners?.includes(number);
  if (!isOwner) return;

  m.chat = jid;
  m.isGroup = isGroup;
  m.sender = sender;
  m.pushName = pushname;

  const reply = (text) => sock.sendMessage(jid, { text }, { quoted: m });
  m.reply = reply;

  if (!sessions[sender]) sessions[sender] = crypto.randomUUID();
  const sessionId = sessions[sender];
  const localState = { currentSession: sessionId };

  const prefix = '/';
  if (m.body?.startsWith(prefix)) {
    const cmdResult = await handleCommand(m.body, localState);
    if (cmdResult) {
      sessions[sender] = localState.currentSession;
      if (cmdResult.action === 'reply') {
        await reply(`⚙️ *SISTEM*\n━━━━━━━━━━━━━━━━\n_${cmdResult.message}_`);
      }
      if (cmdResult.action === 'exit') {
        await reply('❌ Command /exit tidak tersedia di WhatsApp.');
      }
      return;
    }
  }

  await sock.sendPresenceUpdate('composing', jid).catch(() => {});

  const contextHeader = await buildContextAndEnrich(sock, sessionId, m);
  const hasMedia = ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage', 'stickerMessage'].includes(m.mtype);

  if (hasMedia) {
    const messageType = m.mtype;
    const dl = await downloadWhatsAppFile(m, messageType);
    if (!dl.success) {
      await reply(`❌ *Gagal Download File*\n━━━━━━━━━━━━━━━━\nError: ${dl.error}`);
      return;
    }

    const caption = m.message[messageType]?.caption || '';
    const analysisPrompt = buildMediaPrompt(dl, caption);
    const confirmation = `✅ *File Diterima*\n━━━━━━━━━━━━━━━━\n📁 Nama: ${dl.filename}\n📊 Ukuran: ${dl.size}KB\n📂 Tipe: ${dl.mimeType}\n💾 Lokasi: ${dl.filePath}\n\n${caption ? `📝 Caption: ${caption}` : ''}\n\nSedang menganalisis...`;
    await reply(confirmation);

    try {
      const result = await askWithContext(sessionId, contextHeader, analysisPrompt);
      if (result?.trim()) await reply(formatWhatsAppMessage(result));
    } catch (err) {
      console.error('[WA AI FILE]', err.message);
      await reply(`⚠️ *Error Analisis File*\n━━━━━━━━━━━━━━━━\n${err.message}\n\nFile tetap tersimpan di: ${dl.filePath}`);
    }
    return;
  }

  const userInput = (() => {
    if (m.mtype === 'imageMessage' || m.mtype === 'videoMessage') {
      return `[User mengirim ${m.mtype === 'imageMessage' ? 'gambar' : 'video'}]${m.body ? `: ${m.body}` : ''}`;
    }
    if (m.mtype === 'audioMessage') return '[User mengirim pesan suara — transkripsi belum tersedia]';
    if (m.mtype === 'documentMessage') {
      const fname = m.message.documentMessage?.fileName || 'dokumen';
      return `[User mengirim dokumen: ${fname}]`;
    }
    return m.body || '';
  })();

  try {
    const result = await askWithContext(sessionId, contextHeader, userInput);
    await sock.sendPresenceUpdate('paused', jid).catch(() => {});
    await reply(formatWhatsAppMessage(result));
  } catch (err) {
    await sock.sendPresenceUpdate('paused', jid).catch(() => {});
    console.error('[WA LLM]', err.message);
    await reply(`❌ Maaf, terjadi kesalahan: ${err.message}`);
  }
};

export async function sendFileToSession(sessionId, filePath, caption = '') {
  const chatId = Object.keys(sessions).find(k => sessions[k] === sessionId);
  if (!chatId || !client) return '❌ Sesi tidak ditemukan atau client belum terhubung.';
  return sendFile(client, chatId, filePath, caption);
}