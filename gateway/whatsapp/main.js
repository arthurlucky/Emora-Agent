import 'dotenv/config'
import { rmSync, existsSync } from 'fs'
import chalk from 'chalk'
import { Boom } from '@hapi/boom'

import { setClient, handler } from './handler.js'

import {
  useMultiFileAuthState,
  DisconnectReason
} from '@whiskeysockets/baileys'
import { initLidOwners, sleep } from './lib/utils.js'
import { createSocket } from './lib/socket.js'

console.clear()

process.on('uncaughtException', console.error)
process.on('unhandledRejection', (reason, promise) => {
  console.log(chalk.red('[ UNHANDLED REJECTION ]'), promise, '\nReason:', reason)
})

const blue  = (t) => `\x1b[96m${t}\x1b[0m`
const green = (t) => `\x1b[92m${t}\x1b[0m`
const red   = (t) => `\x1b[31m${t}\x1b[0m`
const yellow = (t) => `\x1b[93m${t}\x1b[0m`

const WA_PHONE   = (process.env.WA_PHONE_NUMBER || '').replace(/\D/g, '')
const paircode   = process.env.PAIRING_CODE
const WA_GATEWAY = process.env.WA_GATEWAY === 'true'
const SESSION_DIR = './session'

// ── Retry state ──────────────────────────────────────────────────────────────
let retryCount = 0
const MAX_RETRY = 5
const RETRY_DELAYS = [3000, 5000, 10000, 20000, 30000] // backoff bertahap

function getRetryDelay() {
  return RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)]
}

function clearSession() {
  try {
    if (existsSync(SESSION_DIR)) {
      rmSync(SESSION_DIR, { recursive: true, force: true })
      console.log(yellow('[WA] Sesi lama dihapus.'))
    }
  } catch (_) { /* abaikan */ }
}

async function startBot() {
  if (!WA_GATEWAY) {
    console.log('[WA] Gateway dinonaktifkan (WA_GATEWAY != true)')
    return
  }
  if (!WA_PHONE) {
    console.log('[WA] WA_PHONE_NUMBER tidak ditemukan di .env. Gateway dibatalkan.')
    return
  }

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR)
  const wasRegistered = state.creds.registered

  let sock
  try {
    sock = await createSocket(state)
  } catch (err) {
    console.error(red('[WA] Gagal membuat socket:'), err.message)
    await scheduleReconnect()
    return
  }

  // ── Minta pairing code SETELAH socket siap, bukan sebelum ──────────────
  // Baileys memerlukan QR/pairing dalam window tertentu setelah koneksi dibuka.
  // Kita pasang listener dulu, baru minta kode di dalam event 'open'.
  let pairingRequested = false

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update
    const statusCode = lastDisconnect?.error?.output?.statusCode

    // ── Koneksi terbuka ────────────────────────────────────────────────────
    if (connection === 'open') {
      retryCount = 0  // reset counter saat berhasil
      setClient(sock)
      console.log(green('[ SUCCESS ] Bot berhasil terhubung'))
      await sleep(3000)
      initLidOwners(sock)
      return
    }

    // ── Belum registered → minta pairing code saat WA siap ──────────────
    // WA mengirim QR update sebagai sinyal bahwa server siap menerima pairing request
    if (!wasRegistered && !pairingRequested && qr !== undefined) {
      pairingRequested = true
      try {
        const phoneNum = WA_PHONE
        console.log(yellow(`[ PAIRING ] Meminta kode untuk nomor ${phoneNum}...`))
        const code = await sock.requestPairingCode(phoneNum, paircode)
        console.log(green(`[ KODE PAIRING ] ${code}`))
      } catch (e) {
        console.log(red('[ ERROR ] Gagal mendapatkan pairing code:'), e.message)
      }
      return
    }

    // ── Koneksi putus ─────────────────────────────────────────────────────
    if (connection === 'close') {
      setClient(null)
      console.log(red(`[ KONEKSI ] Terputus — status: ${statusCode}`))

      // Logout resmi atau sesi ditolak WA
      if (
        statusCode === DisconnectReason.loggedOut ||
        statusCode === 401
      ) {
        // Jika sebelumnya sudah terdaftar → ini genuine logout → hapus sesi
        // Jika belum terdaftar (baru pairing) → ini connection error biasa, jangan hapus
        if (wasRegistered) {
          console.log(red('[WA] Akun logout dari perangkat lain. Menghapus sesi...'))
          clearSession()
        } else {
          console.log(yellow('[WA] Koneksi ditutup saat proses pairing (belum terdaftar).'))
        }
        await scheduleReconnect()
        return
      }

      // Koneksi ditutup sementara (bukan logout) → reconnect
      if (
        statusCode !== DisconnectReason.loggedOut &&
        statusCode !== 403 // banned → jangan reconnect
      ) {
        console.log(blue('[ RECONNECT ] Menyambungkan ulang...'))
        await scheduleReconnect()
      } else if (statusCode === 403) {
        console.log(red('[WA] Nomor diblokir atau dilarang oleh WhatsApp. Hentikan bot.'))
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0]
    
    if (!m) return
    await handler(sock, m)
  })

  sock.ev.on('creds.update', saveCreds)
}

async function scheduleReconnect() {
  retryCount++
  if (retryCount > MAX_RETRY) {
    console.log(red(`[WA] Gagal reconnect setelah ${MAX_RETRY}x percobaan. Berhenti.`))
    console.log(yellow('[WA] Jalankan ulang bot secara manual untuk reset.'))
    return
  }
  const delay = getRetryDelay()
  console.log(yellow(`[WA] Reconnect percobaan ${retryCount}/${MAX_RETRY} dalam ${delay / 1000}s...`))
  await sleep(delay)
  startBot().catch(err => console.error('[WA ERROR]', err.message))
}

if (WA_GATEWAY) {
  startBot().catch(err => console.error('[WA ERROR]', err.message))
}
