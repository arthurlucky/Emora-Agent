/**
 * cli/cmd-send.js — `emora send`
 *
 * Kirim pesan satu kali ke Telegram atau WhatsApp tanpa membuka agent loop
 * dan tanpa memanggil LLM apapun. Berguna untuk:
 *   - Shell script: emora send --to=telegram "Deploy berhasil ✅"
 *   - Cron job notifikasi
 *   - CI/CD hook
 *   - Monitoring daemon
 *
 * Usage:
 *   emora send "teks pesan"
 *   emora send --to=telegram "teks"
 *   emora send --to=whatsapp --number=6281xxx "teks"
 *   emora send --to=telegram --chat-id=123456 "teks"
 *   cat report.txt | emora send --to=telegram
 */

import "dotenv/config";
import process from "process";
import chalk from "chalk";

const C = {
  green:  chalk.hex("#3fb950"),
  red:    chalk.hex("#f85149"),
  cyan:   chalk.hex("#58a6ff"),
  muted:  chalk.hex("#8b949e"),
  bold:   chalk.bold,
};


function parseArgs(argv) {
  const args = { to: null, chatId: null, number: null, channel: null, message: [], pipe: false };
  for (const a of argv) {
    if (a.startsWith("--to="))       args.to      = a.slice(5).toLowerCase();
    else if (a.startsWith("--chat-id=")) args.chatId = a.slice(10);
    else if (a.startsWith("--number=")) args.number  = a.slice(9);
    else if (a.startsWith("--channel=")) args.channel = a.slice(10);
    else if (!a.startsWith("--"))      args.message.push(a);
  }
  return args;
}

async function readStdin() {
  if (process.stdin.isTTY) return null; // tidak ada pipe
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => { data += c; });
    process.stdin.on("end", () => resolve(data.trim()));
  });
}

async function sendTelegram(text, chatId) {
  const token = process.env.TELEGRAM_TOKEN_BOT;
  if (!token) throw new Error("TELEGRAM_TOKEN_BOT tidak di-set di .env");

  const targets = chatId
    ? [chatId]
    : (process.env.TELEGRAM_ALLOWED_IDS || "").split(",").map(s=>s.trim()).filter(Boolean);

  if (!targets.length) throw new Error("Tidak ada chat ID target. Gunakan --chat-id=xxx atau isi TELEGRAM_ALLOWED_IDS di .env");

  let sent = 0;
  for (const target of targets) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: target, text, parse_mode: "Markdown" }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`Telegram API error: ${body.description}`);
    sent++;
  }
  return sent;
}

async function sendDiscord(text, channelId) {
  const token = process.env.DISCORD_TOKEN_BOT;
  if (!token) throw new Error("DISCORD_TOKEN_BOT tidak di-set di .env");

  const targets = channelId
    ? [channelId]
    : (process.env.DISCORD_ALLOWED_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);

  if (!targets.length) throw new Error("Tidak ada channel/user ID target. Gunakan --channel=xxx atau isi DISCORD_ALLOWED_IDS di .env");

  let sent = 0;
  for (const target of targets) {
    const res = await fetch(`https://discord.com/api/v10/channels/${target}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bot ${token}` },
      body: JSON.stringify({ content: text.slice(0, 2000) }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`Discord API error: ${body.message || res.statusText}`);
    }
    sent++;
  }
  return sent;
}

async function sendWhatsApp(text, number) {
  // WhatsApp butuh Baileys yang sudah connect (session tersimpan di disk).
  // Import client yang sudah booted kalau session ada, bukan boot ulang penuh.
  const sessionDir = "./downloads/whatsapp";
  const { existsSync } = await import("fs");
  if (!existsSync(sessionDir)) {
    throw new Error(
      "Session WhatsApp belum ada. Jalankan `emora gateway` minimal sekali untuk pairing, baru bisa pakai `emora send --to=whatsapp`."
    );
  }

  // Lazy import supaya tidak load semua deps Baileys kalau target-nya Telegram
  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = await import("@whiskeysockets/baileys");
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const target = number
    ? `${number.replace(/\D/g, "")}@s.whatsapp.net`
    : `${(process.env.WA_ALLOWED_NUMBERS || "").split(",")[0]?.trim().replace(/\D/g,"")}@s.whatsapp.net`;

  if (!target || target === "@s.whatsapp.net") {
    throw new Error("Tidak ada nomor target. Gunakan --number=628xxx atau isi WA_ALLOWED_NUMBERS di .env");
  }

  return new Promise((resolve, reject) => {
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: { level: "silent", child: () => ({ level: "silent", child:()=>({}) }) },
    });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
      if (connection === "open") {
        try {
          await sock.sendMessage(target, { text });
          await sock.logout().catch(() => {});
          resolve(1);
        } catch (err) {
          reject(err);
        }
      } else if (connection === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code !== DisconnectReason.loggedOut) reject(new Error("WhatsApp connection closed unexpectedly"));
      }
    });

    // Timeout 15 detik kalau tidak connect-connect
    setTimeout(() => reject(new Error("WhatsApp connection timeout (15s). Session mungkin expired.")), 15000);
  });
}

export async function cmdSend(argv) {
  const args = parseArgs(argv);

  // Baca dari stdin (pipe) kalau ada
  const piped = await readStdin();
  const text  = piped || args.message.join(" ");

  if (!text) {
    console.error(C.red("  ✗ Tidak ada pesan. Gunakan: emora send \"pesan\" atau pipe ke stdin"));
    console.error(C.muted('  Contoh: echo "Deploy OK" | emora send --to=telegram'));
    process.exit(1);
  }

  // Auto-detect platform kalau --to tidak disebutkan
  let platform = args.to;
  if (!platform) {
    const tgOk = process.env.TELEGRAM_GATEWAY === "true" && process.env.TELEGRAM_TOKEN_BOT;
    const waOk = process.env.WA_GATEWAY === "true" && process.env.WA_PHONE_NUMBER;
    const dcOk = process.env.DISCORD_GATEWAY === "true" && process.env.DISCORD_TOKEN_BOT;
    const activeCount = [tgOk, waOk, dcOk].filter(Boolean).length;

    if (activeCount === 1) {
      platform = tgOk ? "telegram" : waOk ? "whatsapp" : "discord";
    } else if (activeCount > 1) {
      console.error(C.red("  ✗ Lebih dari satu gateway aktif. Tentukan dengan --to=telegram, --to=whatsapp, atau --to=discord"));
      process.exit(1);
    } else {
      console.error(C.red("  ✗ Tidak ada gateway aktif. Jalankan emora setup / emora gateway setup dulu."));
      process.exit(1);
    }
  }

  try {
    if (platform === "telegram") {
      const n = await sendTelegram(text, args.chatId);
      console.log(C.green(`  ✓ Terkirim ke ${n} chat Telegram`));
    } else if (platform === "whatsapp") {
      await sendWhatsApp(text, args.number);
      console.log(C.green("  ✓ Terkirim via WhatsApp"));
    } else if (platform === "discord") {
      const n = await sendDiscord(text, args.channel);
      console.log(C.green(`  ✓ Terkirim ke ${n} channel Discord`));
    } else {
      throw new Error(`Platform tidak dikenal: ${platform}. Gunakan telegram, whatsapp, atau discord.`);
    }
  } catch (err) {
    console.error(C.red(`  ✗ Gagal mengirim: ${err.message}`));
    process.exit(1);
  }
}
