/**
 * gateway/whatsapp/whatsapp.js
 *
 * Gateway WhatsApp EMORA — dibangun ulang mengacu pola amane.
 * Menggunakan @whiskeysockets/baileys sesuai dokumentasi resmi.
 * 
 * Perbaikan & tambahan berdasarkan README.md Baileys:
 *  - LID resolution dengan fallback store.contacts & lid-mapping.json
 *  - Group metadata caching yang proper (cachedGroupMetadata + store)
 *  - Pairing Code flow yang stabil
 *  - normalizeMessageIds sebelum processing
 *  - Anti double-response (filter BAE5/903D message ID)
 *  - m object yang kaya (isGroup, sender, quoted, body, mtype, dll)
 *  - Reconnect logic lengkap per DisconnectReason
 *  - makeInMemoryStore untuk group metadata cache
 *  - getMessage untuk retry system & decrypt poll votes [reference:2]
 *  - messages.update untuk menangani poll votes [reference:3]
 *  - browser: Browsers.macOS('Desktop') + syncFullHistory: true [reference:4]
 *  - markOnlineOnConnect: false agar notifikasi tetap muncul di HP [reference:5]
 */

import "dotenv/config";
import crypto    from "crypto";
import fs        from "fs";
import path      from "path";

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeInMemoryStore,
  getContentType,
  downloadContentFromMessage,
  jidDecode,
  delay,
  Browsers,                       // untuk setting browser desktop [reference:6]
  getAggregateVotesInPollMessage, // untuk decrypt poll votes [reference:7]
} from "@whiskeysockets/baileys";
import pino from "pino";
import { Boom } from "@hapi/boom";

import { createLLM }         from "../../provider/index.js";
import tools                 from "../../core/tools.js";
import { ask }               from "../../core/chat.js";
import { handleCommand }     from "../../core/cmd.js";
import { eventBus }          from "../../utils/eventBus.js";
import { formatWhatsAppMessage } from "./formatter.js";
import { sendFile, sendText }    from "./sender.js";
import { getBotStatus, getMemberStatus } from "./groupManager.js";
import { setContext, buildContextHeader }  from "../sessionContext.js";

// ─── Config ────────────────────────────────────────────────────────────────────
const WA_PHONE    = (process.env.WA_PHONE_NUMBER || "").replace(/\D/g, "");
const WA_GATEWAY  = process.env.WA_GATEWAY === "true";
const SESSION_DIR = path.resolve("./downloads/whatsapp");
const ALLOWED     = (process.env.WA_ALLOWED_NUMBERS || "")
  .split(",").map(n => `${n.trim().replace(/\D/g, "")}@s.whatsapp.net`).filter(Boolean);

// ─── Exports ───────────────────────────────────────────────────────────────────
// sessions: senderId → sessionId (untuk LLM memory)
export const sessions = {};
export let   client   = null;

// ─── LLM ───────────────────────────────────────────────────────────────────────
let llm;
try {
  llm = await createLLM(tools);
} catch (err) {
  console.error("[WA] Gagal init LLM:", err.message);
}

// ─── Background tasks ──────────────────────────────────────────────────────────
const bgLocks = {};
eventBus.on("execute_bg_task", async ({ job_id, session_id, prompt }) => {
  if (bgLocks[job_id]) return;
  bgLocks[job_id] = true;
  try {
    const bgSess = `${session_id}_bg_${job_id}`;
    const result = await ask(llm, tools, bgSess, `[BACKGROUND TASK] ${prompt}`);
    if (!result.includes("SILENT_ABORT") && client) {
      const chatId = Object.keys(sessions).find(k => sessions[k] === session_id);
      if (chatId) await client.sendMessage(chatId, { text: formatWhatsAppMessage(result) });
    }
  } catch (e) {
    console.error("[WA BG ERROR]", e.message);
  } finally {
    bgLocks[job_id] = false;
  }
});

// ─── JID helpers ───────────────────────────────────────────────────────────────
function decodeJid(jid) {
  if (!jid) return jid;
  if (/:\d+@/gi.test(jid)) {
    const d = jidDecode(jid) || {};
    return (d.user && d.server) ? `${d.user}@${d.server}` : jid;
  }
  return jid;
}

const lidCache = new Map();
// Map untuk menyimpan mapping lid → jid dari file auth (akan dimuat saat startup)
let lidMapping = new Map();

// ─── Improved LID resolution dengan fallback ke store.contacts ──────────────
async function resolveLidToJid(sock, id, store) {
  if (!id) return id;
  if (!id.endsWith("@lid")) return decodeJid(id);
  
  // 1. Cek cache memory
  if (lidCache.has(id)) return lidCache.get(id);
  
  // 2. Cek store.contacts (jika ada)
  if (store?.contacts) {
    const contact = Object.values(store.contacts).find(c => c.id === id);
    if (contact?.phoneNumber) {
      const jid = `${contact.phoneNumber}@s.whatsapp.net`;
      lidCache.set(id, jid);
      return jid;
    }
  }
  
  // 3. Cek lid-mapping dari file auth (load di bawah)
  if (lidMapping.has(id)) {
    const jid = lidMapping.get(id);
    lidCache.set(id, jid);
    return jid;
  }
  
  // 4. Fallback: onWhatsApp API
  try {
    const res = await sock.onWhatsApp(id);
    const wjid = res?.[0]?.jid || id;
    const final = decodeJid(wjid);
    lidCache.set(id, final);
    // Simpan ke lidMapping untuk persistensi
    lidMapping.set(id, final);
    return final;
  } catch {
    return id;
  }
}

// ─── Memuat lid-mapping dari file auth (jika ada) ────────────────────────────
function loadLidMapping() {
  const mappingFile = path.join(SESSION_DIR, 'lid-mapping.json');
  if (fs.existsSync(mappingFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(mappingFile, 'utf-8'));
      lidMapping = new Map(Object.entries(data));
    } catch (e) {
      console.warn('[WA] Gagal muat lid-mapping:', e.message);
    }
  }
}
loadLidMapping();

// ─── Menyimpan lid-mapping secara periodik atau saat creds.update ────────────
function saveLidMapping() {
  const mappingFile = path.join(SESSION_DIR, 'lid-mapping.json');
  try {
    const obj = Object.fromEntries(lidMapping);
    fs.writeFileSync(mappingFile, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.warn('[WA] Gagal simpan lid-mapping:', e.message);
  }
}

// Perbarui resolveLidToJid agar menerima store
async function normalizeMessageIds(sock, msg, store) {
  if (msg?.key?.participant)        msg.key.participant = await resolveLidToJid(sock, msg.key.participant, store);
  if (msg?.participant)             msg.participant     = await resolveLidToJid(sock, msg.participant, store);
  if (msg?.key?.remoteJid)         msg.key.remoteJid   = decodeJid(msg.key.remoteJid);

  // Unwrap ephemeral/viewOnce wrappers
  const unwrap = (m) => {
    if (!m) return m;
    if (m.ephemeralMessage)      return unwrap(m.ephemeralMessage.message);
    if (m.viewOnceMessage)       return unwrap(m.viewOnceMessage.message);
    if (m.viewOnceMessageV2)     return unwrap(m.viewOnceMessageV2.message);
    return m;
  };
  const realMsg   = unwrap(msg.message);
  const type      = realMsg ? Object.keys(realMsg)[0] : null;
  const node      = type ? realMsg[type] : null;
  const ctx       = node?.contextInfo;

  if (ctx?.participant) ctx.participant = await resolveLidToJid(sock, ctx.participant, store);
  if (Array.isArray(ctx?.mentionedJid) && ctx.mentionedJid.length) {
    ctx.mentionedJid = await Promise.all(ctx.mentionedJid.map(j => resolveLidToJid(sock, j, store)));
  }
  return msg;
}

// ─── Build rich "m" object (terinspirasi dari amane.js) ───────────────────────
async function parseMessage(sock, raw, store) {
  const m = { ...raw };

  m.chat     = m.key.remoteJid || "";
  m.isGroup  = m.chat.endsWith("@g.us");
  m.sender   = m.key.fromMe
    ? decodeJid(sock.user.id)
    : (m.key.participant || m.key.remoteJid || "");
  m.pushName = m.pushName || "User";

  // Message type
  m.mtype = getContentType(m.message);
  if (["ephemeralMessage","viewOnceMessage","viewOnceMessageV2"].includes(m.mtype)) {
    m.message = m.message[m.mtype].message;
    m.mtype   = getContentType(m.message);
  }

  // Body (teks utama pesan)
  if (m.mtype === "interactiveResponseMessage" || m.message?.interactiveResponseMessage) {
    try {
      const ir = m.message.interactiveResponseMessage || m.message[m.mtype];
      m.body = JSON.parse(ir.nativeFlowResponseMessage.paramsJson).id;
    } catch { m.body = ""; }
  } else {
    m.body =
      m.mtype === "conversation"              ? m.message.conversation :
      m.mtype === "imageMessage"              ? m.message.imageMessage?.caption :
      m.mtype === "videoMessage"              ? m.message.videoMessage?.caption :
      m.mtype === "extendedTextMessage"       ? m.message.extendedTextMessage?.text :
      m.mtype === "buttonsResponseMessage"    ? m.message.buttonsResponseMessage?.selectedButtonId :
      m.mtype === "listResponseMessage"       ? m.message.listResponseMessage?.singleSelectReply?.selectedRowId :
      m.mtype === "templateButtonReplyMessage"? m.message.templateButtonReplyMessage?.selectedId :
      m.text || "";
  }
  m.body = typeof m.body === "string" ? m.body : "";

  // Quoted message
  const rawCtx = m.message?.[m.mtype]?.contextInfo;
  if (rawCtx?.quotedMessage) {
    let qMsg = rawCtx.quotedMessage;
    if (qMsg.viewOnceMessageV2)          qMsg = qMsg.viewOnceMessageV2.message;
    else if (qMsg.viewOnceMessage)       qMsg = qMsg.viewOnceMessage.message;
    const qType = getContentType(qMsg) || Object.keys(qMsg)[0];
    m.quoted = {
      key: {
        remoteJid:   m.chat,
        fromMe:      rawCtx.participant === decodeJid(sock.user.id),
        id:          rawCtx.stanzaId,
        participant: rawCtx.participant,
      },
      message:  qMsg,
      mtype:    qType,
      msg:      qMsg[qType],
      sender:   rawCtx.participant,
      text:     qMsg.conversation || qMsg[qType]?.text || qMsg[qType]?.caption || "",
      fakeObj: {
        key: {
          remoteJid:   m.chat,
          fromMe:      rawCtx.participant === decodeJid(sock.user.id),
          id:          rawCtx.stanzaId,
          participant: rawCtx.participant,
        },
        message: qMsg,
      },
      download: async () => {
        const stream = await downloadContentFromMessage(qMsg[qType], qType.replace("Message",""));
        let buf = Buffer.from([]);
        for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
        return buf;
      },
    };
  }

  // Download media
  m.download = async () => {
    const stream = await downloadContentFromMessage(m.message[m.mtype], m.mtype.replace("Message",""));
    let buf = Buffer.from([]);
    for await (const chunk of stream) buf = Buffer.concat([buf, chunk]);
    return buf;
  };

  // Group metadata
  let groupMetadata = null;
  if (m.isGroup) {
    store.groupMetadata = store.groupMetadata || {};
    groupMetadata = store.groupMetadata[m.chat];
    if (!groupMetadata) {
      try {
        groupMetadata = await sock.groupMetadata(m.chat);
        store.groupMetadata[m.chat] = groupMetadata;
      } catch {}
    }

    // Resolve @lid sender to real JID
    if (m.sender.endsWith("@lid") && groupMetadata?.participants) {
      const found = groupMetadata.participants.find(p => p.lid === m.sender);
      if (found?.jid) m.sender = found.jid;
    }
  }

  const participants = groupMetadata?.participants || [];
  const botJid       = decodeJid(sock.user.id);
  m.groupName        = groupMetadata?.subject || "";
  m.groupAdmins      = participants.filter(p => p.admin).map(p => p.jid || p.id);
  m.isBotAdmin       = m.groupAdmins.includes(botJid);
  m.isSenderAdmin    = m.groupAdmins.includes(m.sender);

  return m;
}

// ─── Context helper ────────────────────────────────────────────────────────────
async function buildContextAndEnrich(sock, m, sessionId) {
  let botIsAdmin    = null;
  let senderIsAdmin = null;

  if (m.isGroup) {
    botIsAdmin    = m.isBotAdmin;
    senderIsAdmin = m.isSenderAdmin;
  }

  const replyToMessage = m.quoted
    ? { id: m.quoted.key.id, participant: m.quoted.key.participant || null }
    : null;

  const ctx = {
    platform:       "whatsapp",
    chatId:         m.chat,
    chatType:       m.isGroup ? "group" : "private",
    chatTitle:      m.groupName || null,
    senderId:       m.sender,
    senderName:     m.pushName || m.sender.split("@")[0],
    senderIsAdmin,
    botIsAdmin,
    replyToMessage,
  };
  setContext(sessionId, ctx);
  return buildContextHeader(ctx);
}

// ─── Reply helper ──────────────────────────────────────────────────────────────
async function reply(sock, m, text) {
  const formatted = formatWhatsAppMessage(text);
  const chunks    = [];
  // Pecah pesan >4096 karakter (batas WA) menjadi beberapa pesan
  for (let i = 0; i < formatted.length; i += 4000) {
    chunks.push(formatted.slice(i, i + 4000));
  }
  for (const chunk of chunks) {
    await sock.sendMessage(m.chat, { text: chunk }, { quoted: m });
    if (chunks.length > 1) await delay(500);
  }
}

// ─── Main connection ───────────────────────────────────────────────────────────
async function connect(retryCount = 0) {
  if (!WA_GATEWAY) {
    console.log("[WA] Gateway dinonaktifkan (WA_GATEWAY != true)");
    return;
  }
  if (!WA_PHONE) {
    console.log("[WA] WA_PHONE_NUMBER tidak ditemukan di .env. Gateway dibatalkan.");
    return;
  }
  if (!llm) {
    console.log("[WA] LLM tidak tersedia. Gateway dibatalkan.");
    return;
  }

  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const { version }          = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  const store = makeInMemoryStore({
    logger: pino({ level: "silent" }).child({ level: "silent", stream: "store" }),
  });

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys:  makeCacheableSignalKeyStore(
        state.keys,
        pino({ level: "silent" }).child({ level: "silent" })
      ),
    },
    // ─── Rekomendasi dari README.md Baileys ──────────────────────────────
    // 1. Browser desktop untuk history lebih lengkap [reference:8]
    browser: Browsers.macOS('Desktop'),
    // 2. Sync full history [reference:9]
    syncFullHistory: true,
    // 3. Notifikasi tetap muncul di HP [reference:10]
    markOnlineOnConnect: false,
    // ──────────────────────────────────────────────────────────────────────
    connectTimeoutMs:     60_000,
    defaultQueryTimeoutMs:20_000,
    keepAliveIntervalMs:  10_000,
    emitOwnEvents:        true,
    generateHighQualityLinkPreview: true,
    shouldSyncHistoryMessage: () => false,
    // 4. getMessage untuk retry system & decrypt poll votes [reference:11]
    getMessage: async (key) => {
      if (!store) return null;
      const msg = await store.loadMessage(key.remoteJid, key.id);
      return msg?.message || null;
    },
    // 5. cachedGroupMetadata untuk optimasi grup [reference:12]
    cachedGroupMetadata: async (jid) => {
      if (!jid.endsWith("@g.us")) return;
      let gm = store.groupMetadata?.[jid];
      if (!gm) {
        try {
          gm = await sock.groupMetadata(jid);
          store.groupMetadata = store.groupMetadata || {};
          store.groupMetadata[jid] = gm;
        } catch {}
      }
      return gm;
    },
    patchMessageBeforeSending: (message) => {
      if (message.buttonsMessage || message.templateMessage || message.listMessage) {
        message = {
          viewOnceMessage: {
            message: {
              messageContextInfo: { deviceListMetadataVersion: 2, deviceListMetadata: {} },
              ...message,
            },
          },
        };
      }
      return message;
    },
  });

  store.bind(sock.ev);

  // Override sendMessage — tambah random messageId
  const _sendMessage = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid, content, options = {}) => {
    if (!options.messageId) options.messageId = crypto.randomBytes(16).toString("hex").toUpperCase();
    return _sendMessage(jid, content, options);
  };

  // ── Pairing Code (jika belum terdaftar) ──────────────────────────────────
  if (!sock.authState.creds.registered) {
    console.log("[WA] Belum terdaftar, meminta Pairing Code...");
    await delay(3000);
    try {
      let code = await sock.requestPairingCode(WA_PHONE);
      code = code?.match(/.{1,4}/g)?.join("-") || code;
      console.log(`\n[WA] 📱 PAIRING CODE: ${code}`);
      console.log(`[WA] Masukkan kode ini di WhatsApp → Perangkat Tertaut → Tautkan dengan nomor\n`);
    } catch (err) {
      console.error("[WA] Gagal meminta Pairing Code:", err.message);
    }
  }

  // ── Connection update ──────────────────────────────────────────────────────
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "connecting") {
      console.log("[WA] Menghubungkan...");
    }

    if (connection === "open") {
      client = sock;
      retryCount = 0;
      console.log("[WA] ✅ Terhubung ke WhatsApp!");
    }

    if (connection === "close") {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(`[WA] Koneksi terputus (reason: ${reason})`);
      client = null;

      // Reconnect berdasarkan reason (sesuai contoh di README) [reference:13]
      if (reason === DisconnectReason.loggedOut) {
        console.log("[WA] Sesi logout. Hapus folder session dan jalankan ulang untuk pairing ulang.");
        return;
      }
      if (reason === DisconnectReason.connectionReplaced) {
        console.log("[WA] Koneksi digantikan sesi lain. Hentikan proses lain yang memakai nomor yang sama.");
        return;
      }

      const waitMs = Math.min(5000 * Math.pow(2, Math.min(retryCount, 5)), 60_000);
      console.log(`[WA] Mencoba hubungkan ulang dalam ${waitMs / 1000}s... (attempt ${retryCount + 1})`);
      await delay(waitMs);
      connect(retryCount + 1);
    }
  });

  sock.ev.on("creds.update", saveCreds);
  // Simpan lid-mapping saat creds update
  sock.ev.on("creds.update", () => {
    saveLidMapping();
  });

  // ── Group updates (update cache saat ada perubahan) ───────────────────────
  sock.ev.on("groups.update", async (updates) => {
    for (const update of updates) {
      if (store.groupMetadata?.[update.id]) {
        Object.assign(store.groupMetadata[update.id], update);
      }
    }
  });

  sock.ev.on("group-participants.update", async ({ id, participants, action }) => {
    if (!store.groupMetadata?.[id]) return;
    const meta = store.groupMetadata[id];
    if (!meta.participants) return;
    if (action === "remove") {
      meta.participants = meta.participants.filter(p => !participants.includes(p.jid || p.id));
    } else if (action === "add") {
      participants.forEach(jid => {
        if (!meta.participants.find(p => (p.jid || p.id) === jid)) {
          meta.participants.push({ id: jid, jid, admin: null });
        }
      });
    } else if (action === "promote") {
      meta.participants.forEach(p => {
        if (participants.includes(p.jid || p.id)) p.admin = "admin";
      });
    } else if (action === "demote") {
      meta.participants.forEach(p => {
        if (participants.includes(p.jid || p.id)) p.admin = null;
      });
    }
  });

  // ── Poll votes (messages.update) ───────────────────────────────────────────
  // Menangani voting di polling messages [reference:14]
  sock.ev.on("messages.update", async (event) => {
    for (const { key, update } of event) {
      if (update.pollUpdates) {
        // Ambil pesan pembuat poll dari store
        const pollCreation = await store.loadMessage(key.remoteJid, key.id);
        if (pollCreation) {
          const votes = getAggregateVotesInPollMessage({
            message: pollCreation,
            pollUpdates: update.pollUpdates,
          });
          console.log('[WA] Poll votes:', votes);
          // Anda bisa mengirim notifikasi atau memproses hasil voting di sini
        }
      }
    }
  });

  // ── Anti-call ─────────────────────────────────────────────────────────────
  sock.ev.on("call", async (callUpdates) => {
    for (const call of callUpdates) {
      if (call.isGroup) continue;
      if (call.status === "offer" || call.status === "ringing") {
        try { await sock.rejectCall?.(call.id, call.from); } catch {}
        await sock.sendMessage(call.from, {
          text: "Maaf, EMORA tidak bisa menerima panggilan. Kirim pesan saja ya 😊",
        });
      }
    }
  });

  // ── Message handler ───────────────────────────────────────────────────────
  sock.ev.on("messages.upsert", async (chatUpdate) => {
    try {
      const raw = chatUpdate.messages?.[0];
      if (!raw?.message) return;

      // Status broadcast → read saja, tidak diproses
      if (raw.key?.remoteJid === "status@broadcast") {
        await sock.readMessages([raw.key]).catch(() => {});
        return;
      }

      // Anti double-response: filter pesan dari bot lain / echo
      const rawId = String(raw.key.id || "");
      const baseId = rawId.split("-")[0];
      if (baseId.startsWith("BAE5") || (baseId.length === 14 && rawId.startsWith("903D"))) return;

      // Normalize LID JIDs (dengan store)
      await normalizeMessageIds(sock, raw, store);

      // Parse ke objek m yang kaya
      const m = await parseMessage(sock, raw, store);

      if (!m.body && !["imageMessage","videoMessage","audioMessage","documentMessage","stickerMessage"].includes(m.mtype)) return;

      // Allowed number filter
      const senderId = m.sender.split("@")[0];
      if (ALLOWED.length > 0 && !ALLOWED.includes(m.sender) && !m.key.fromMe) return;

      // Ignore pesan dari diri sendiri (echo)
      if (m.key.fromMe) return;

      // ── Presence: typing indicator ───────────────────────────────────────
      await sock.sendPresenceUpdate("composing", m.chat).catch(() => {});

      // ── Session management ───────────────────────────────────────────────
      // Key sesi pakai senderId bukan chatId, supaya satu orang satu sesi lintas grup
      if (!sessions[m.sender]) {
        sessions[m.sender] = crypto.randomUUID();
      }
      const sessionId = sessions[m.sender];

      const localState = { currentSession: sessionId };

      // ── Slash commands ───────────────────────────────────────────────────
      if (m.body.startsWith("/")) {
        const cmdResult = await handleCommand(m.body, localState);
        if (cmdResult) {
          sessions[m.sender] = localState.currentSession;
          if (cmdResult.action === "reply") {
            await reply(sock, m, `⚙️ *SISTEM*\n━━━━━━━━━━━━━━━━\n_${cmdResult.message}_`);
          }
          if (cmdResult.action === "exit") {
            await reply(sock, m, "❌ Command /exit tidak tersedia di WhatsApp.");
          }
          return;
        }
      }

      // ── Context awareness ────────────────────────────────────────────────
      const contextHeader = await buildContextAndEnrich(sock, m, sessionId);

      // ── Siapkan input ke LLM ─────────────────────────────────────────────
      let userInput = contextHeader;

      if (m.mtype === "imageMessage" || m.mtype === "videoMessage") {
        const caption = m.body || "";
        userInput += `[User mengirim ${m.mtype === "imageMessage" ? "gambar" : "video"}]${caption ? `: ${caption}` : ""}`;
      } else if (m.mtype === "audioMessage") {
        userInput += "[User mengirim pesan suara — transkripsi belum tersedia]";
      } else if (m.mtype === "documentMessage") {
        const fname = m.message.documentMessage?.fileName || "dokumen";
        userInput += `[User mengirim dokumen: ${fname}]`;
      } else {
        userInput += m.body;
      }

      // ── Call LLM ─────────────────────────────────────────────────────────
      try {
        const result = await ask(llm, tools, sessionId, userInput);
        await sock.sendPresenceUpdate("paused", m.chat).catch(() => {});
        await reply(sock, m, result);
      } catch (err) {
        await sock.sendPresenceUpdate("paused", m.chat).catch(() => {});
        console.error("[WA LLM ERROR]", err.message);
        await reply(sock, m, `❌ Maaf, terjadi kesalahan: ${err.message}`);
      }

    } catch (err) {
      console.error("[WA HANDLER ERROR]", err);
    }
  });

  return sock;
}

// ─── sendFileToUser (dipanggil dari gateway/index.js) ────────────────────────
export async function sendFileToSession(sessionId, filePath, caption = "") {
  const chatId = Object.keys(sessions).find(k => sessions[k] === sessionId);
  if (!chatId || !client) return "❌ Sesi tidak ditemukan atau client belum terhubung.";
  return sendFile(client, chatId, filePath, caption);
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
if (WA_GATEWAY) {
  connect().catch(err => console.error("[WA INIT ERROR]", err.message));
}