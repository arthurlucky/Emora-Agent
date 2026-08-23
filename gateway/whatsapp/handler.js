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
import { touchSession } from '../../core/sessionStore.js';
import { TurnStateManager } from '../session.js';
import { handleCronCommand } from '../cron/commands.js';
import { getManager } from '../manager.js';

export const turns = new TurnStateManager('whatsapp');
const pendingApprovals = new Map(); // senderId -> { resolve }

// Sama seperti fix di gateway/telegram/telegram.js: commandResult.action ===
// "help" dulu gak pernah dirender (falls-through tanpa balasan).
const WHATSAPP_HELP_TEXT =
  "⎔ *Perintah EMORA (WhatsApp)*\n\n" +
  "*Gateway:* /status /stop /mode <safe|autonomous> /cron ...\n" +
  "*Sesi:* /new /sesi [id] /clear /sesilist /sesiinfo <id> /sesidel <id>\n" +
  "*Plugin & Artifact:* /plugin list|disable|enable|reload|install · /artifact list|get|delete\n" +
  "*Skill:* /learn <nama> (susun skill baru dari sesi ini) · /<nama_skill_atau_command> (jalankan skill/command apa pun — bawaan atau dari plugin — langsung)\n\n" +
  "Ketik pesan biasa untuk ngobrol dengan EMORA.";

function splitWA(text, limit = 4000) {
  if (text.length <= limit) return [text];
  const chunks = [];
  for (let i = 0; i < text.length; i += limit) chunks.push(text.slice(i, i + limit));
  return chunks;
}

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

async function askWithContext(sessionId, contextHeader, rawMessage, extra = {}) {
  const enriched = contextHeader ? `${contextHeader}\n${rawMessage}` : rawMessage;
  return ask(llm, tools, sessionId, enriched, extra);
}

async function requestWhatsAppApproval(replyFn, senderId, toolName, args) {
  const argsJson = JSON.stringify(args || {}, null, 2);
  const trimmed = argsJson.length > 800 ? argsJson.slice(0, 800) + '\n…' : argsJson;
  const content = `⚠️ *EMORA minta izin jalankan tool:* ${toolName}\n\`\`\`\n${trimmed}\n\`\`\`\nBalas */yes* atau */no*.`;
  await replyFn(content);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingApprovals.delete(senderId);
      replyFn('⏱ Timeout menunggu approval, otomatis ditolak.').catch((err) => { console.error('[Ignored Error]', err.message); });
      resolve(false);
    }, 5 * 60 * 1000);

    pendingApprovals.set(senderId, {
      resolve: (val) => { clearTimeout(timeout); resolve(val); },
    });
  });
}

/** Return null kalau bukan perintah gateway baru, supaya lanjut ke handleCommand() bawaan. */
async function handleGatewayCommand(senderId, text) {
  if (!text.startsWith('/')) return null;
  const [cmdRaw, ...args] = text.trim().split(/\s+/);
  const cmd = cmdRaw.slice(1).toLowerCase();

  switch (cmd) {
    case 'status':
      return `⎔ *EMORA Gateway (WhatsApp)*\nMode: ${turns.getMode(senderId)}\nSedang jalan: ${turns.isRunning(senderId) ? 'ya' : 'tidak'}\nTotal sesi aktif: ${turns.activeChatCount()}`;

    case 'yes':
    case 'no': {
      const pending = pendingApprovals.get(senderId);
      if (!pending) return 'ℹ Gak ada approval yang lagi nunggu.';
      pendingApprovals.delete(senderId);
      pending.resolve(cmd === 'yes');
      return cmd === 'yes' ? '✔ Disetujui.' : '✘ Ditolak.';
    }

    case 'stop':
      return turns.stop(senderId) ? '⏹ Proses dihentikan.' : 'ℹ Gak ada proses yang lagi jalan.';

    case 'continue':
      return 'ℹ EMORA jalan otomatis sampai selesai tiap giliran — gak ada proses yang perlu di-/continue.';

    case 'mode': {
      const val = (args[0] || '').toLowerCase();
      if (val !== 'safe' && val !== 'autonomous') {
        return `Mode saat ini: *${turns.getMode(senderId)}*. Pakai /mode safe atau /mode autonomous.`;
      }
      turns.setMode(senderId, val);
      return `✔ Mode diganti ke *${val}*.`;
    }

    case 'cron': {
      const mgr = getManager();
      return handleCronCommand(mgr.cronStore, 'whatsapp', senderId, '', args, {
        runNow: (job) => mgr.cronScheduler.runJobNow(job),
        reload: () => mgr.cronScheduler.reload(),
      });
    }

    default:
      return null;
  }
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
    const gwReply = await handleGatewayCommand(sender, m.body);
    if (gwReply !== null) {
      if (gwReply) await reply(gwReply);
      return;
    }

    const cmdResult = await handleCommand(m.body, localState);
    if (cmdResult) {
      sessions[sender] = localState.currentSession;
      if (cmdResult.action === 'reply') {
        await reply(`⚙️ *SISTEM*\n━━━━━━━━━━━━━━━━\n_${cmdResult.message}_`);
      }
      if (cmdResult.action === 'exit') {
        await reply('❌ Command /exit tidak tersedia di WhatsApp.');
      }
      if (cmdResult.action === 'help') {
        await reply(WHATSAPP_HELP_TEXT);
      }
      return;
    }
  }

  await sock.sendPresenceUpdate('composing', jid).catch((err) => { console.error('[Ignored Error]', err.message); });

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
      const signal = turns.beginTurn(sender);
      const mode = turns.getMode(sender);
      const onApproval = (toolName, args) => requestWhatsAppApproval(reply, sender, toolName, args);
      const result = await askWithContext(sessionId, contextHeader, analysisPrompt, { onApproval, mode, signal });
      if (result?.trim()) await reply(formatWhatsAppMessage(result));
      touchSession(sessionId).catch((err) => { console.error('[Ignored Error]', err.message); });
    } catch (err) {
      if (err?.aborted) {
        await reply('⏹ Dihentikan.');
      } else {
        console.error('[WA AI FILE]', err.message);
        await reply(`⚠️ *Error Analisis File*\n━━━━━━━━━━━━━━━━\n${err.message}\n\nFile tetap tersimpan di: ${dl.filePath}`);
      }
    } finally {
      turns.endTurn(sender);
      turns.touch(sender);
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
    const signal = turns.beginTurn(sender);
    const mode = turns.getMode(sender);
    const onApproval = (toolName, args) => requestWhatsAppApproval(reply, sender, toolName, args);
    const result = await askWithContext(sessionId, contextHeader, userInput, { onApproval, mode, signal });
    await sock.sendPresenceUpdate('paused', jid).catch((err) => { console.error('[Ignored Error]', err.message); });
    const safeResult = (result || '').trim()
      ? result
      : '⚠️ _Agent tidak menghasilkan balasan untuk pesan ini. Coba tanya ulang ya._';
    await reply(formatWhatsAppMessage(safeResult));
    touchSession(sessionId).catch((err) => { console.error('[Ignored Error]', err.message); });
  } catch (err) {
    await sock.sendPresenceUpdate('paused', jid).catch((err) => { console.error('[Ignored Error]', err.message); });
    if (err?.aborted) {
      await reply('⏹ Dihentikan.');
    } else {
      console.error('[WA LLM]', err.message);
      await reply(`❌ Maaf, terjadi kesalahan: ${err.message}`);
    }
  } finally {
    turns.endTurn(sender);
    turns.touch(sender);
  }
};

export async function sendFileToSession(sessionId, filePath, caption = '') {
  const chatId = Object.keys(sessions).find(k => sessions[k] === sessionId);
  if (!chatId || !client) return '❌ Sesi tidak ditemukan atau client belum terhubung.';
  return sendFile(client, chatId, filePath, caption);
}