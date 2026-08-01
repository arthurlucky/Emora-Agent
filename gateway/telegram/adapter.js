/**
 * gateway/telegram/adapter.js
 *
 * Menjembatani telegram.js (yang sudah ada & self-start berdasarkan
 * TELEGRAM_TOKEN_BOT) ke Manager baru supaya bisa dikontrol on-demand
 * lewat `emora gateway start/stop/status telegram` atau `/gateway` di TUI.
 *
 * Catatan: modul ESM di-cache oleh Node — begitu telegram.js pernah
 * di-import sekali (dan otomatis start), start berikutnya di proses yang
 * sama tinggal manggil ulang bot.launch() pada instance yang sama alih-alih
 * re-import (yang tidak akan menjalankan ulang top-level code-nya).
 */
import { registerAdapter } from "../manager.js";

class TelegramGatewayAdapter {
  constructor(config) {
    this.config = config;
    this._mod = null;
  }

  name() { return "telegram"; }

  async start() {
    if (this.config.token && !process.env.TELEGRAM_TOKEN_BOT) {
      process.env.TELEGRAM_TOKEN_BOT = this.config.token;
    }
    if (this.config.allowedUsers?.length && !process.env.TELEGRAM_ALLOWED_IDS) {
      process.env.TELEGRAM_ALLOWED_IDS = this.config.allowedUsers.join(",");
    }

    if (!this._mod) {
      // Import pertama kali -> memicu self-start di dalam telegram.js.
      this._mod = await import("./telegram.js");
      if (!this._mod.bot) {
        throw new Error("Gagal start Telegram bot — cek TELEGRAM_TOKEN_BOT.");
      }
    } else if (this._mod.bot) {
      // Sudah pernah di-import sebelumnya (mis. sempat di-stop) -> restart
      // polling di instance bot yang sama.
      await this._mod.bot.launch({ dropPendingUpdates: true });
    }
  }

  async stop() {
    if (this._mod?.bot) {
      this._mod.bot.stop("manager-stop");
    }
  }

  status() {
    const running = !!this._mod?.bot;
    return {
      running,
      platform: "telegram",
      info: running
        ? `${Object.keys(this._mod.sessions || {}).length} sesi tercatat`
        : "belum dijalankan",
    };
  }

  async sendText(chatId, text) {
    if (!this._mod?.bot) throw new Error("Telegram bot belum aktif.");
    await this._mod.bot.telegram.sendMessage(chatId, text);
  }
}

registerAdapter("telegram", (config) => new TelegramGatewayAdapter(config));

export { TelegramGatewayAdapter };
