import 'dotenv/config'
import crypto from 'crypto'
import pino from 'pino'
import { Boom } from '@hapi/boom'
import { getContentType } from '@whiskeysockets/baileys'

import { createLLM }       from '../../provider/index.js'
import tools               from '../../core/tools.js'
import { ask }             from '../../core/chat.js'
import { handleCommand }   from '../../core/cmd.js'
import { eventBus }        from '../../utils/eventBus.js'
import { setContext, buildContextHeader } from '../sessionContext.js'
import { sendFile, sendText } from './sender.js'
import { formatWhatsAppMessage } from './formatter.js'

export const sessions = {}
export let   client   = null
export function setClient(sock) {
  client = sock
}


async function buildContextAndEnrich(sock, sessionId,m){
  let botIsAdmin    = null;
  let senderIsAdmin = null;

  if (m.isGroup) {
    botIsAdmin    = m.isBotAdmin;
    senderIsAdmin = m.isSenderAdmin;
  }
  
  
  const ctx = {
    platform:       "whatsapp",
    chatId:         m.chat,
    chatType:       m.isGroup ? "group" : "private",
    chatTitle:      m.groupName || null,
    senderId:       m.sender,
    senderName:     m.pushName || m.sender.split("@")[0],
    senderIsAdmin,
    botIsAdmin,
  };
  console.log(ctx)
  setContext(sessionId, ctx);
  return buildContextHeader(ctx);
}


// ─── LLM ──────────────────────────────────────────────────────────────────────
let llm
try {
  llm = await createLLM(tools)
} catch (err) {
  console.error('[WA] Gagal init LLM:', err.message)
}

// ─── Background tasks ─────────────────────────────────────────────────────────
const bgLocks = {}
eventBus.on('execute_bg_task', async ({ job_id, session_id, prompt }) => {
  if (bgLocks[job_id]) return
  bgLocks[job_id] = true
  try {
    const bgSess  = `${session_id}_bg_${job_id}`
    const result  = await ask(llm, tools, bgSess, `[BACKGROUND TASK] ${prompt}`)
    if (!result.includes('SILENT_ABORT') && client) {
      const chatId = Object.keys(sessions).find(k => sessions[k] === session_id)
      if (chatId) await client.sendMessage(chatId, { text: formatWhatsAppMessage(result) })
    }
  } catch (e) {
    console.error('[WA BG ERROR]', e.message)
  } finally {
    bgLocks[job_id] = false
  }
})

// ─── Main handler ─────────────────────────────────────────────────────────────
export const handler = async (sock, m) => {
  if (!m.message) return
  if (m.key.fromMe) return

  // ── Unwrap ephemeral / viewOnce ──────────────────────────────────────────
  m.mtype = getContentType(m.message)
  if (['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2'].includes(m.mtype)) {
    m.message = m.message[m.mtype].message
    m.mtype   = getContentType(m.message)
  }

  // ── Body (teks utama pesan) ──────────────────────────────────────────────
  if (m.mtype === 'interactiveResponseMessage' || m.message?.interactiveResponseMessage) {
    try {
      const ir = m.message.interactiveResponseMessage || m.message[m.mtype]
      m.body   = JSON.parse(ir.nativeFlowResponseMessage.paramsJson).id
    } catch { m.body = '' }
  } else {
    m.body =
      m.mtype === 'conversation'               ? m.message.conversation :
      m.mtype === 'imageMessage'               ? m.message.imageMessage?.caption :
      m.mtype === 'videoMessage'               ? m.message.videoMessage?.caption :
      m.mtype === 'extendedTextMessage'        ? m.message.extendedTextMessage?.text :
      m.mtype === 'buttonsResponseMessage'     ? m.message.buttonsResponseMessage?.selectedButtonId :
      m.mtype === 'listResponseMessage'        ? m.message.listResponseMessage?.singleSelectReply?.selectedRowId :
      m.mtype === 'templateButtonReplyMessage' ? m.message.templateButtonReplyMessage?.selectedId :
      ''
  }

  // ── Metadata ──────────────────────────────────────────────────────────────
  const jid         = m.key.remoteJid
  if (!jid) return

  const isGroup     = jid.endsWith('@g.us')
  const sender      = isGroup ? m.key.participant : jid
  const number      = sender?.split('@')[0] || '-'
  const pushname    = m.pushName || 'Unknown'
  const botNumber   = sock.decodeJid(sock.user.id)
  const isOwner     =
    global.owner?.includes(number) ||
    global.lidowners?.includes(number)
  let groupMetadata = {}
    let participants = []
    let isAdmin = false
    let groupAdmins = false
    let groupName = ""
  m.chat = jid
  m.isGroup = isGroup
  m.sender = sender
    if (m.isGroup) {
      groupAdmins      = participants.filter(p => p.admin).map(p => p.jid || p.id);
        groupMetadata = await sock.groupMetadata(jid)
        participants = groupMetadata.participants || []
        isAdmin = participants.some(v => v.id === sender && v.admin !== null)
       groupName = groupMetadata?.subject
 
  m.isBotAdmin       = groupAdmins.includes(botJid);
  m.isSenderAdmin    = groupAdmins.includes(m.sender);
  m.groupName = groupAdmins
    }
  
  
  

  // Hanya respon owner (sesuai konfigurasi asal)
  if (!isOwner) return

  const reply = (text) => sock.sendMessage(jid, { text }, { quoted: m })
  m.reply = reply

  // ── Sesi ─────────────────────────────────────────────────────────────────
  if (!sessions[sender]) sessions[sender] = crypto.randomUUID()
  const sessionId  = sessions[sender]
  const localState = { currentSession: sessionId }

  // ── Command handler ───────────────────────────────────────────────────────
  const prefix = '/'
  const body   = m.body || ''
  if (body.startsWith(prefix)) {
    const cmdResult = await handleCommand(body, localState)
    if (cmdResult) {
      sessions[sender] = localState.currentSession
      if (cmdResult.action === 'reply') {
        await reply(`⚙️ *SISTEM*\n━━━━━━━━━━━━━━━━\n_${cmdResult.message}_`)
      }
      if (cmdResult.action === 'exit') {
        await reply('❌ Command /exit tidak tersedia di WhatsApp.')
      }
      return
    }
  }

  // ── Typing indicator ──────────────────────────────────────────────────────
  await sock.sendPresenceUpdate('composing', jid).catch(() => {})

  // ── Context header ────────────────────────────────────────────────────────
  
  
  const contextHeader = await buildContextAndEnrich(sock, sessionId,m)

  // ── Susun userInput ───────────────────────────────────────────────────────
  let userInput = contextHeader ? `${contextHeader}\n` : ''

  if (m.mtype === 'imageMessage' || m.mtype === 'videoMessage') {
    const caption = m.body || ''
    userInput += `[User mengirim ${m.mtype === 'imageMessage' ? 'gambar' : 'video'}]${caption ? `: ${caption}` : ''}`
  } else if (m.mtype === 'audioMessage') {
    userInput += '[User mengirim pesan suara — transkripsi belum tersedia]'
  } else if (m.mtype === 'documentMessage') {
    const fname = m.message.documentMessage?.fileName || 'dokumen'
    userInput += `[User mengirim dokumen: ${fname}]`
  } else {
    userInput += body
  }

  // ── LLM ───────────────────────────────────────────────────────────────────
  try {
    const result = await ask(llm, tools, sessionId, userInput)
    await sock.sendPresenceUpdate('paused', jid).catch(() => {})
    await reply(formatWhatsAppMessage(result))
  } catch (err) {
    await sock.sendPresenceUpdate('paused', jid).catch(() => {})
    console.error('[WA LLM ERROR]', err.message)
    await reply(`❌ Maaf, terjadi kesalahan: ${err.message}`)
  }
}

// ─── Helper untuk tool sendFile ───────────────────────────────────────────────
export async function sendFileToSession(sessionId, filePath, caption = '') {
  const chatId = Object.keys(sessions).find(k => sessions[k] === sessionId)
  if (!chatId || !client) return '❌ Sesi tidak ditemukan atau client belum terhubung.'
  return sendFile(client, chatId, filePath, caption)
}
