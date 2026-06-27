import {
  makeWASocket,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  downloadContentFromMessage,
  prepareWAMessageMedia,
  jidDecode,
  proto,
  generateWAMessageFromContent,
  generateMessageID,
  generateWAMessage,
  Browsers
} from '@whiskeysockets/baileys'

import pino from 'pino'

export async function createSocket(state) {
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    browser: Browsers.macOS('Chrome'),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
    },
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: true,
    syncFullHistory: false,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    defaultQueryTimeoutMs: 60000,
    retryRequestDelayMs: 250,
  })

  sock.decodeJid = (jid) => {
    if (!jid) return jid
    if (/:\d+@/gi.test(jid)) {
      const decode = jidDecode(jid) || {}
      return (decode.user && decode.server)
        ? `${decode.user}@${decode.server}`
        : jid
    }
    return jid
  }

  sock.downloadMediaMessage = async (message) => {
    let mime = (message.msg || message).mimetype || ''
    let messageType = message.mtype
      ? message.mtype.replace(/Message/gi, '')
      : mime.split('/')[0]

    if (!['image', 'video', 'audio', 'sticker'].includes(messageType)) {
      messageType = 'document'
    }

    const stream = await downloadContentFromMessage(message, messageType)
    let buffer = Buffer.from([])
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk])
    }
    return buffer
  }

  sock.sendRichResponse = async (jid, data = {}, options = {}) => {
    let { randomUUID } = await import('crypto')
    let submessages = []
    let sections = []
    let sources = []

    if (data.text) {
      submessages.push({ messageType: 2, messageText: data.text })
      sections.push({
        view_model: {
          primitive: { text: data.text, __typename: 'GenAIMarkdownTextUXPrimitive' },
          __typename: 'GenAISingleLayoutViewModel'
        }
      })
    }

    if (data.table) {
      const tableRows = [
        { items: data.table.headers, isHeading: true },
        ...data.table.rows.map(row => ({ items: row.map(String) }))
      ]
      submessages.push({
        messageType: 4,
        tableMetadata: { title: data.table.title || 'Datos', rows: tableRows }
      })
    }

    if (data.code) {
      const tokenizer = (codeStr) => {
        const tokens = []
        let i = 0
        const len = codeStr.length
        const keywords = ['break','case','catch','continue','debugger','default','delete','do',
          'else','finally','for','function','if','in','instanceof','new','return','switch',
          'this','throw','try','typeof','var','void','while','with','true','false','null',
          'undefined','NaN','Infinity','class','let','super','extends','export','import',
          'yield','static','constructor','of','async','await','get','set']
        while (i < len) {
          if (/\s/.test(codeStr[i])) {
            const start = i
            while (i < len && /\s/.test(codeStr[i])) i++
            tokens.push({ content: codeStr.slice(start, i), type: 'DEFAULT' })
            continue
          }
          if (codeStr[i] === '"' || codeStr[i] === "'") {
            const start = i; const quote = codeStr[i]; i++
            while (i < len && codeStr[i] !== quote) { if (codeStr[i] === '\\') i++; i++ }
            i++
            tokens.push({ content: codeStr.slice(start, i), type: 'STR' })
            continue
          }
          if (/[0-9]/.test(codeStr[i])) {
            const start = i
            while (i < len && /[0-9.]/.test(codeStr[i])) i++
            tokens.push({ content: codeStr.slice(start, i), type: 'NUMBER' })
            continue
          }
          if (/[a-zA-Z_$]/.test(codeStr[i])) {
            const start = i
            while (i < len && /[a-zA-Z0-9_$]/.test(codeStr[i])) i++
            const word = codeStr.slice(start, i)
            if (keywords.includes(word)) {
              tokens.push({ content: word, type: 'KEYWORD' })
            } else {
              let j = i
              while (j < len && /\s/.test(codeStr[j])) j++
              tokens.push({ content: word, type: j < len && codeStr[j] === '(' ? 'METHOD' : 'DEFAULT' })
            }
            continue
          }
          tokens.push({ content: codeStr[i], type: 'DEFAULT' })
          i++
        }
        const merged = []
        for (const t of tokens) {
          if (merged.length && merged[merged.length - 1].type === 'DEFAULT' && t.type === 'DEFAULT') {
            merged[merged.length - 1].content += t.content
          } else { merged.push(t) }
        }
        return merged
      }
      const rawTokens = tokenizer(data.code.code)
      const typeToHighlight = { DEFAULT: 0, KEYWORD: 1, METHOD: 2, STR: 3, NUMBER: 5 }
      submessages.push({
        messageType: 5,
        codeMetadata: {
          codeLanguage: data.code.language || 'javascript',
          codeBlocks: rawTokens.map(t => ({
            codeContent: t.content,
            highlightType: typeToHighlight[t.type] || 0
          }))
        }
      })
      sections.push({
        view_model: {
          primitive: {
            language: data.code.language || 'javascript',
            code_blocks: rawTokens,
            __typename: 'GenAICodeUXPrimitive'
          },
          __typename: 'GenAISingleLayoutViewModel'
        }
      })
    }

    if (data.reels && data.reels.length > 0) {
      const uploadedReels = []
      for (const item of data.reels) {
        const videoMedia = await prepareWAMessageMedia(
          { video: { url: item.videoUrl }, mimetype: 'video/mp4', fileName: `${Date.now()}reel.mp4` },
          { upload: sock.waUploadToServer }
        )
        const thumbMedia = await prepareWAMessageMedia(
          { image: { url: item.thumbnailUrl }, mimetype: 'image/jpeg', fileName: `${Date.now()}thumb.jpg` },
          { upload: sock.waUploadToServer }
        )
        const profileMedia = await prepareWAMessageMedia(
          { image: { url: item.profileIconUrl }, mimetype: 'image/jpeg', fileName: `${Date.now()}profile.jpg` },
          { upload: sock.waUploadToServer }
        )
        uploadedReels.push({
          title: item.title || 'Reel',
          description: item.description || 'Video',
          profileIconUrl: profileMedia.imageMessage?.url || item.profileIconUrl,
          thumbnailUrl: thumbMedia.imageMessage?.url || item.thumbnailUrl,
          videoUrl: videoMedia.videoMessage?.url || item.videoUrl
        })
      }
      submessages.push({
        messageType: 9,
        contentItemsMetadata: {
          contentType: 1,
          itemsMetadata: uploadedReels.map(item => ({
            reelItem: { title: item.title, profileIconUrl: item.profileIconUrl, thumbnailUrl: item.thumbnailUrl, videoUrl: item.videoUrl }
          }))
        }
      })
      sections.push({
        view_model: {
          primitives: uploadedReels.map(item => ({
            reels_url: item.videoUrl, thumbnail_url: item.thumbnailUrl,
            creator: item.title, avatar_url: item.profileIconUrl,
            reels_title: item.description, likes_count: 0, shares_count: 0, view_count: 0,
            reel_source: 'IG', is_verified: false, __typename: 'GenAIReelPrimitive'
          })),
          __typename: 'GenAIHScrollLayoutViewModel'
        }
      })
      uploadedReels.forEach((item, idx) => {
        sources.push({
          provider: 'UNKNOWN', thumbnailCDNURL: item.thumbnailUrl,
          sourceProviderURL: item.videoUrl, sourceQuery: '',
          faviconCDNURL: item.profileIconUrl, citationNumber: idx + 1, sourceTitle: item.title
        })
      })
    }

    const unifiedResponseData = { response_id: randomUUID(), sections }
    const content = {
      messageContextInfo: {
        deviceListMetadata: {}, deviceListMetadataVersion: 2,
        botMetadata: { pluginMetadata: {}, richResponseSourcesMetadata: { sources } }
      },
      botForwardedMessage: {
        message: {
          richResponseMessage: {
            messageType: 1,
            submessages,
            unifiedResponse: { data: JSON.stringify(unifiedResponseData) },
            contextInfo: {
              forwardingScore: 1, isForwarded: true,
              forwardedAiBotMessageInfo: { botJid: '867051314767696@bot' },
              forwardOrigin: 4, mentionedJid: data.mentionedJid || []
            }
          }
        }
      }
    }
    return await sock.relayMessage(jid, content, { messageId: `EMORA_${Date.now()}` })
  }

  return sock
}
