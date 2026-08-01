/**
 * gateway/whatsapp/adapter.js
 *
 * Menjembatani WhatsApp (main.js + handler.js, pairing-code based) ke
 * Manager baru. Beda dengan Telegram/Discord, koneksi WhatsApp di Baileys
 * bersifat stateful (QR/pairing code, auth folder, lock file `wa.lock`) dan
 * sudah auto-start sendiri berdasar WA_GATEWAY di .env — jadi adapter ini
 * fokus di STATUS REPORTING & kirim pesan (dipakai cron), bukan start/stop
 * paksa di tengah proses yang sama (matikan dgn cara paksa berisiko
 * korupsi state auth). Untuk restart total, hentikan & jalankan ulang
 * proses `emora gateway run`.
 */
import { registerAdapter } from "../manager.js";

class WhatsAppGatewayAdapter {
  constructor(config) {
    this.config = config;
    this._mod = null;
  }

  name() { return "whatsapp"; }

  async start() {
    if (!this._mod) {
      if (this.config.extra?.phoneNumber && !process.env.WA_PHONE_NUMBER) {
        process.env.WA_PHONE_NUMBER = this.config.extra.phoneNumber;
      }
      // Import ini memicu bootstrap koneksi WhatsApp (self-start di main.js).
      this._mod = await import("./main.js");
      this._handlerMod = await import("./handler.js");
    } else if (!this._handlerMod?.client) {
      throw new Error("WhatsApp belum konek. Cek pairing code / QR di log server, atau restart proses gateway.");
    }
  }

  async stop() {
    // Baileys tidak punya API "stop bersih" yang aman dipanggil ulang tanpa
    // merusak state auth di tengah proses yang sama — best effort saja.
    try {
      await this._handlerMod?.client?.end?.(new Error("stopped by manager"));
    } catch { /* noop, lihat catatan di atas */ }
  }

  status() {
    const connected = !!this._handlerMod?.client;
    return {
      running: connected,
      platform: "whatsapp",
      info: connected
        ? `${Object.keys(this._handlerMod.sessions || {}).length} sesi tercatat`
        : "belum konek (cek pairing code di log)",
    };
  }

  async sendText(chatId, text) {
    if (!this._handlerMod?.client) throw new Error("WhatsApp client belum aktif.");
    await this._handlerMod.client.sendMessage(chatId, { text });
  }
}

registerAdapter("whatsapp", (config) => new WhatsAppGatewayAdapter(config));

export { WhatsAppGatewayAdapter };
