/**
 * gateway/discord/index.js
 *
 * Adapter Discord untuk EMORA gateway. Satu channel/DM/thread = satu sesi
 * percakapan. Perintah dikirim sebagai teks biasa (`/status`, `/reset`,
 * `/mode safe`, `/cron ...`, dst) — bukan slash command Discord — supaya
 * tidak perlu proses registrasi application command yang bisa telat
 * propagasinya dan butuh scope tambahan saat invite bot.
 *
 * Pola pemetaan channel -> session id sengaja disamakan dengan yang sudah
 * dipakai gateway/telegram & gateway/whatsapp (`crypto.randomUUID()`
 * disimpan di map sederhana) supaya konsisten & otomatis kompatibel
 * dengan core/sessionStore.js (yang mensyaratkan format UUID).
 */
import { Client, GatewayIntentBits, Partials, Events } from "discord.js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { ask } from "../../core/chat.js";
import tools from "../../core/tools.js";
import skillRegistry from "../../core/skillRegistry.js";
import { createLLM } from "../../provider/index.js";
import { registerAdapter } from "../manager.js";
import { TurnStateManager } from "../session.js";
import { touchSession } from "../../core/sessionStore.js";
import { handleCronCommand } from "../cron/commands.js";
import { splitMessage, formatToolLine, buildApprovalRow, approvalContent } from "./presenter.js";

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const SESSION_MAP_FILE = path.resolve("./gateway/discord/session-map.json");

function loadSessionMap() {
  try { return JSON.parse(fs.readFileSync(SESSION_MAP_FILE, "utf8")); } catch { return {}; }
}
function saveSessionMap(map) {
  fs.mkdirSync(path.dirname(SESSION_MAP_FILE), { recursive: true });
  fs.writeFileSync(SESSION_MAP_FILE, JSON.stringify(map, null, 2));
}

class DiscordGateway {
  constructor(config) {
    this.config = config;
    this.client = null;
    this.turns = new TurnStateManager("discord");
    this.sessionMap = loadSessionMap(); // channelId -> sessionId (uuid)
    this.pendingApprovals = new Map(); // channelId -> { nonce, message, content, resolve }
    this._llmPromise = null;
    this._cleanupTimer = null;
  }

  name() { return "discord"; }

  async _getLLM() {
    if (!this._llmPromise) this._llmPromise = createLLM(tools);
    return this._llmPromise;
  }

  _sessionIdFor(channelId) {
    let id = this.sessionMap[channelId];
    if (!id) {
      id = crypto.randomUUID();
      this.sessionMap[channelId] = id;
      saveSessionMap(this.sessionMap);
    }
    return id;
  }

  _resetSessionFor(channelId) {
    const id = crypto.randomUUID();
    this.sessionMap[channelId] = id;
    saveSessionMap(this.sessionMap);
    return id;
  }

  _isAllowed(userId) {
    const list = this.config.allowedUsers || [];
    return list.length === 0 || list.includes(userId);
  }

  async _onApproval(channel, toolName, args) {
    const nonce = crypto.randomUUID();
    const content = approvalContent(toolName, args);
    const row = buildApprovalRow(nonce);
    const sent = await channel.send({ content, components: [row] });

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(channel.id);
        sent.edit({ content: content + "\n\n⏱ *Timeout — otomatis ditolak.*", components: [] }).catch((err) => { console.error('[Ignored Error]', err.message); });
        resolve(false);
      }, APPROVAL_TIMEOUT_MS);

      this.pendingApprovals.set(channel.id, {
        nonce,
        message: sent,
        content,
        resolve: (val) => { clearTimeout(timeout); resolve(val); },
      });
    });
  }

  async _handleCommand(message, channelKey, args) {
    const cmd = (args[0] || "").toLowerCase();
    const rest = args.slice(1);

    switch (cmd) {
      case "status": {
        await message.reply(
          `⎔ *EMORA Gateway (Discord)*\n` +
          `Mode: ${this.turns.getMode(channelKey)}\n` +
          `Sedang jalan: ${this.turns.isRunning(channelKey) ? "ya" : "tidak"}\n` +
          `Total channel aktif: ${this.turns.activeChatCount()}`
        );
        return;
      }
      case "reset": {
        this._resetSessionFor(channelKey);
        await message.reply("✔ Sesi direset — mulai obrolan baru dari nol.");
        return;
      }
      case "yes":
      case "no": {
        const pending = this.pendingApprovals.get(channelKey);
        if (!pending) {
          await message.reply("ℹ Gak ada approval yang lagi nunggu di channel ini.");
          return;
        }
        this.pendingApprovals.delete(channelKey);
        pending.resolve(cmd === "yes");
        await pending.message.edit({ content: pending.content + `\n\n${cmd === "yes" ? "✔ Disetujui" : "✘ Ditolak"} via /${cmd}`, components: [] }).catch((err) => { console.error('[Ignored Error]', err.message); });
        return;
      }
      case "stop": {
        const stopped = this.turns.stop(channelKey);
        await message.reply(stopped ? "⏹ Proses dihentikan." : "ℹ Gak ada proses yang lagi jalan.");
        return;
      }
      case "continue": {
        await message.reply("ℹ EMORA jalan otomatis sampai selesai tiap giliran — gak ada proses yang perlu di-`/continue`.");
        return;
      }
      case "mode": {
        const val = (rest[0] || "").toLowerCase();
        if (val !== "safe" && val !== "autonomous") {
          await message.reply(`Mode saat ini: **${this.turns.getMode(channelKey)}**. Pakai \`/mode safe\` atau \`/mode autonomous\` buat ganti.`);
          return;
        }
        this.turns.setMode(channelKey, val);
        await message.reply(`✔ Mode diganti ke **${val}**.`);
        return;
      }
      case "cron": {
        const out = handleCronCommand(
          this._manager.cronStore, "discord", channelKey, message.guild?.id || "", rest,
          { runNow: (job) => this._manager.cronScheduler.runJobNow(job), reload: () => this._manager.cronScheduler.reload() }
        );
        for (const chunk of splitMessage(out)) await message.reply(chunk);
        return;
      }
      case "help":
        await message.reply(
          "⎔ *Perintah EMORA (Discord)*\n`/status` `/reset` `/mode <safe|autonomous>`\n`/stop` `/yes` `/no`\n`/cron ...` (lihat `/cron` buat detail)\n`/<nama_skill>` — jalankan skill/command apa pun (bawaan/plugin) langsung"
        );
        return;
      default: {
        // Bukan salah satu command bawaan gateway di atas — cek apakah ini
        // skill/command (bawaan ATAU dari plugin) yang bisa dipanggil manual
        // lewat "/<nama>" atau "/<plugin>:<nama>" (lihat core/skillRegistry.js
        // & skill/SKILL.md #15). Pakai resolveCandidates supaya kasus ambigu
        // TETAP diteruskan ke ask() (yang akan kasih pesan disambiguasi),
        // bukan langsung dibalas "gak dikenal".
        const candidates = await skillRegistry.resolveCandidates(cmd);
        if (candidates.length) { await this._handlePrompt(message, channelKey); return; }
        await message.reply(`ℹ Perintah \`/${cmd}\` gak dikenal. Ketik \`/help\` buat lihat daftar perintah, atau cek skill yang tersedia dulu.`);
      }
    }
  }

  async _handlePrompt(message, channelKey) {
    const signal = this.turns.beginTurn(channelKey);
    const mode = this.turns.getMode(channelKey);
    const sessionId = this._sessionIdFor(channelKey);

    await message.channel.sendTyping().catch((err) => { console.error('[Ignored Error]', err.message); });
    const progressLines = [];
    let progressMsg = null;

    const onEvent = (ev) => {
      if (ev.type === "tool_use") progressLines.push(formatToolLine(ev.name, ev.args, ev.autoApproved));
      else if (ev.type === "tool_denied") progressLines.push(`▸ \`${ev.name}\` — ✘ ditolak`);
      else if (ev.type === "skill_read") progressLines.push(`▸ membaca skill: ${ev.name}`);
      else return;

      const text = "🔧 " + progressLines.slice(-8).join("\n");
      if (!progressMsg) {
        message.channel.send(text).then((m) => { progressMsg = m; }).catch((err) => { console.error('[Ignored Error]', err.message); });
      } else {
        progressMsg.edit(text.slice(0, 1900)).catch((err) => { console.error('[Ignored Error]', err.message); });
      }
    };

    const onApproval = (toolName, args) => this._onApproval(message.channel, toolName, args);

    try {
      const llm = await this._getLLM();
      const result = await ask(llm, tools, sessionId, message.content, { onEvent, onApproval, mode, signal });
      const text = typeof result === "string" && result.trim()
        ? result
        : "⚠️ Agent tidak menghasilkan balasan untuk pesan ini. Coba tanya ulang ya.";
      for (const chunk of splitMessage(text)) {
        await message.reply(chunk);
      }
      touchSession(sessionId).catch((err) => { console.error('[Ignored Error]', err.message); });
    } catch (err) {
      if (err?.aborted) {
        await message.reply("⏹ Dihentikan.");
      } else {
        await message.reply(`✘ Error: ${err.message}`);
      }
    } finally {
      this.turns.endTurn(channelKey);
      this.turns.touch(channelKey);
    }
  }

  async start(manager) {
    this._manager = manager;
    if (!this.config.token) throw new Error("Token Discord bot belum diatur (DISCORD_TOKEN_BOT).");

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this.client.on(Events.MessageCreate, async (message) => {
      try {
        if (message.author.bot) return;
        if (this.config.extra?.guildId && message.guild && message.guild.id !== this.config.extra.guildId) return;
        if (!this._isAllowed(message.author.id)) return;

        const channelKey = message.channel.id;
        const maxUsers = this.config.maxUsers || 0;
        if (maxUsers > 0) {
          const isNew = !this.sessionMap[channelKey];
          if (isNew && this.turns.activeChatCount() >= maxUsers) {
            await message.reply("✘ Gateway ini sudah mencapai batas maksimal user aktif.");
            return;
          }
        }

        const content = message.content.trim();
        if (!content) return;

        if (content.startsWith("/")) {
          const args = content.slice(1).split(/\s+/).filter(Boolean);
          await this._handleCommand(message, channelKey, args);
        } else {
          await this._handlePrompt(message, channelKey);
        }
      } catch (err) {
        console.error("[gateway:discord] error handling message:", err);
      }
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isButton()) return;
      const [action, nonce] = interaction.customId.split(":");
      if (action !== "emora_approve" && action !== "emora_deny") return;

      const pending = this.pendingApprovals.get(interaction.channelId);
      if (!pending || pending.nonce !== nonce) {
        await interaction.reply({ content: "Request approval ini sudah kadaluarsa.", ephemeral: true }).catch((err) => { console.error('[Ignored Error]', err.message); });
        return;
      }
      this.pendingApprovals.delete(interaction.channelId);
      const approved = action === "emora_approve";
      await interaction.update({
        content: pending.content + `\n\n${approved ? "✔ Disetujui" : "✘ Ditolak"} oleh ${interaction.user.username}`,
        components: [],
      }).catch((err) => { console.error('[Ignored Error]', err.message); });
      pending.resolve(approved);
    });

    this._cleanupTimer = setInterval(() => this.turns.cleanupInactive(), 5 * 60 * 1000);

    await this.client.login(this.config.token);
  }

  async stop() {
    if (this._cleanupTimer) clearInterval(this._cleanupTimer);
    if (this.client) {
      await this.client.destroy();
      this.client = null;
    }
  }

  status() {
    return {
      running: !!this.client?.isReady?.(),
      platform: "discord",
      info: this.client?.user ? `login sbg ${this.client.user.tag} · ${this.turns.activeChatCount()} channel aktif` : "belum login",
    };
  }

  async sendText(chatId, text) {
    if (!this.client) throw new Error("Discord client belum aktif.");
    const channel = await this.client.channels.fetch(chatId);
    for (const chunk of splitMessage(text)) {
      await channel.send(chunk);
    }
  }
}

registerAdapter("discord", (config) => new DiscordGateway(config));

export { DiscordGateway };
