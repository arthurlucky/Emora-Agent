import 'dotenv/config'
import { rmSync, existsSync, writeFileSync, readFileSync } from 'fs'
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

const blue   = (t) => `\x1b[96m${t}\x1b[0m`
const green  = (t) => `\x1b[92m${t}\x1b[0m`
const red    = (t) => `\x1b[31m${t}\x1b[0m`
const yellow = (t) => `\x1b[93m${t}\x1b[0m`

const WA_PHONE    = (process.env.WA_PHONE_NUMBER || '').replace(/\D/g, '')
const paircode    = process.env.PAIRING_CODE
const WA_GATEWAY  = process.env.WA_GATEWAY === 'true'
const SESSION_DIR = './session'
const LOCK_FILE   = './wa.lock'

// ── Retry state (global, bukan per-closure) ───────────────────────────────────
let retryCount    = 0
let isReconnecting = false
const MAX_RETRY    = 5
const RETRY_DELAYS = [5000, 10000, 15000, 20000, 30000]

function getRetryDelay() {
  return RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)]
}

// ── Lock file: cegah 2 instance jalan bersamaan ───────────────────────────────
function acquireLock() {
  if (existsSync(LOCK_FILE)) {
    const pid = readFileSync(LOCK_FILE, 'utf8').trim()
    // Cek apakah proses dengan PID itu masih hidup
    try {
      process.kill(Number(pid), 0) // signal 0 = hanya cek eksistensi
      console.log(red(`[WA] Instance lain sudah berjalan (PID: ${pid}). Hentikan dulu sebelum menjalankan ulang.`))
      process.exit(1)
    } catch (_) {
      // Proses mati, lock basi → lanjutkan
      console.log(yellow('[WA] Lock basi ditemukan, diabaikan.'))
    }
  }
  writeFileSync(LOCK_FILE, String(process.pid))
}

function releaseLock() {
  try {
    if (existsSync(LOCK_FILE)) rmSync(LOCK_FILE)
  } catch (_) { /* abaikan */ }
}

function clearSession() {
  try {
    if (existsSync(SESSION_DIR)) {
      rmSync(SESSION_DIR, { recursive: true, force: true })
      console.log(yellow('[WA] Sesi lama dihapus.'))
    }
  } catch (_) { /* abaikan */ }
}

// Bersihkan lock saat proses ditutup
process.on('exit',    releaseLock)
process.on('SIGINT',  () => { releaseLock(); process.exit(0) })
process.on('SIGTERM', () => { releaseLock(); process.exit(0) })

// ─────────────────────────────────────────────────────────────────────────────
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
  let pairingRequested = false

  let sock
  try {
    sock = await createSocket(state)
  } catch (err) {
    console.error(red('[WA] Gagal membuat socket:'), err.message)
    await scheduleReconnect()
    return
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update
    const statusCode = lastDisconnect?.error?.output?.statusCode

    // ── Koneksi terbuka ────────────────────────────────────────────────────
    if (connection === 'open') {
      retryCount = 0
      isReconnecting = false
      setClient(sock)
      console.log(green('[ SUCCESS ] Bot berhasil terhubung'))
      await sleep(3000)
      initLidOwners(sock)
      return
    }

    // ── Pairing code (hanya saat belum terdaftar) ─────────────────────────
    if (!wasRegistered && !pairingRequested && qr !== undefined) {
      pairingRequested = true
      try {
        console.log(yellow(`[ PAIRING ] Meminta kode untuk nomor ${WA_PHONE}...`))
        const code = await sock.requestPairingCode(WA_PHONE, paircode)
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

      switch (statusCode) {

        // ── 428: Koneksi direbut instance lain ──────────────────────────
        // Ini bukan error jaringan — WA menutup karena perangkat ke-2 login.
        // Jangan reconnect agresif; tunggu lebih lama agar instance lain selesai.
        case 428:
          console.log(yellow('[WA] Koneksi direbut instance lain (428).'))
          console.log(yellow('[WA] Pastikan tidak ada proses bot lain yang berjalan!'))
          console.log(yellow('[WA] Menunggu 15 detik sebelum reconnect...'))
          await sleep(15000)
          await scheduleReconnect()
          break

        // ── 401 / loggedOut: Sesi tidak valid ───────────────────────────
        case 401:
        case DisconnectReason.loggedOut:
          if (wasRegistered) {
            console.log(red('[WA] Akun logout. Menghapus sesi...'))
            clearSession()
          } else {
            console.log(yellow('[WA] Koneksi ditutup saat proses pairing.'))
          }
          await scheduleReconnect()
          break

        // ── 403: Banned ──────────────────────────────────────────────────
        case 403:
          console.log(red('[WA] Nomor diblokir oleh WhatsApp. Bot dihentikan.'))
          releaseLock()
          process.exit(1)
          break

        // ── Lainnya: error sementara → reconnect ─────────────────────────
        default:
          console.log(blue('[ RECONNECT ] Menyambungkan ulang...'))
          await scheduleReconnect()
          break
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
  // Cegah double-reconnect jika event 'close' dipanggil lebih dari sekali
  if (isReconnecting) return
  isReconnecting = true

  retryCount++
  if (retryCount > MAX_RETRY) {
    console.log(red(`[WA] Gagal reconnect setelah ${MAX_RETRY}x percobaan. Bot dihentikan.`))
    console.log(yellow('[WA] Jalankan ulang secara manual: pm2 restart / node main.js'))
    releaseLock()
    process.exit(1)
  }

  const delay = getRetryDelay()
  console.log(yellow(`[WA] Reconnect percobaan ${retryCount}/${MAX_RETRY} dalam ${delay / 1000}s...`))
  await sleep(delay)
  isReconnecting = false
  startBot().catch(err => console.error('[WA ERROR]', err.message))
}

// ── Entry point ────────────────────────────────────────────────────────────────
if (WA_GATEWAY) {
  acquireLock()
  startBot().catch(err => console.error('[WA ERROR]', err.message))
}
