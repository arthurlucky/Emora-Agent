/**
 * gateway/slack/index.js
 *
 * Adapter Slack untuk EMORA gateway menggunakan Socket Mode.
 * Menggunakan @slack/bolt.
 */
import { App } from "@slack/bolt";
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
const SLACK_LIMIT = 3000;
function splitMessage(text, limit = SLACK_LIMIT) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = limit;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n/, "");
  }
  if (remaining.length) chunks.push(remaining);
  return chunks;
}
function formatToolLine(name, args, autoApproved) {
  const argsPreview = JSON.stringify(args || {});
  const short = argsPreview.length > 120 ? argsPreview.slice(0, 117) + "..." : argsPreview;
  const badge = autoApproved ? " _(auto-approved)_" : "";
  return `▸ \`${name}\`${badge} ${short}`;
}
function approvalContent(toolName, args) {
  const argsJson = JSON.stringify(args || {}, null, 2);
  const trimmed = argsJson.length > 1200 ? argsJson.slice(0, 1200) + "\n…" : argsJson;
  return `⚠️ **EMORA minta izin jalankan tool:** \`${toolName}\`\n\`\`\`json\n${trimmed}\n\`\`\`\nApprove?`;
}

// Command bawaan gateway ini — kalau user ketik "/<salah satu ini>", JANGAN
// dicek ke skillRegistry dulu (biar skill dgn nama sama gak "menutupi"
// command gateway inti).
const RESERVED_GATEWAY_COMMANDS = new Set(["status", "reset", "mode", "help"]);

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const SESSION_MAP_FILE = path.resolve("./gateway/slack/session-map.json");

function loadSessionMap() {
  try { return JSON.parse(fs.readFileSync(SESSION_MAP_FILE, "utf8")); } catch { return {}; }
}
function saveSessionMap(map) {
  fs.mkdirSync(path.dirname(SESSION_MAP_FILE), { recursive: true });
  fs.writeFileSync(SESSION_MAP_FILE, JSON.stringify(map, null, 2));
}

class SlackGateway {
  constructor(config) {
    this.config = config;
    this.app = null;
    this.turns = new TurnStateManager("slack");
    this.sessionMap = loadSessionMap(); // channelId -> sessionId
    this.pendingApprovals = new Map();
    this._llmPromise = null;
    this._cleanupTimer = null;
  }

  name() { return "slack"; }

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

  async _onApproval(say, channelId, toolName, args) {
    const nonce = crypto.randomUUID();
    const content = approvalContent(toolName, args);
    
    // Create Slack blocks for buttons
    const blocks = [
      { type: "section", text: { type: "mrkdwn", text: content } },
      {
        type: "actions",
        elements: [
          { type: "button", text: { type: "plain_text", text: "Izinkan" }, style: "primary", action_id: `emora_approve_${nonce}`, value: nonce },
          { type: "button", text: { type: "plain_text", text: "Tolak" }, style: "danger", action_id: `emora_deny_${nonce}`, value: nonce }
        ]
      }
    ];

    const sent = await say({ text: content, blocks });

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(channelId);
        // We cannot easily edit messages in Bolt without the client and ts, so we just let it expire in state.
        resolve(false);
      }, APPROVAL_TIMEOUT_MS);

      this.pendingApprovals.set(channelId, {
        nonce,
        ts: sent.ts,
        content,
        resolve: (val) => { clearTimeout(timeout); resolve(val); },
      });
    });
  }

  async _handleCommand(say, channelKey, cmd, args) {
    switch (cmd) {
      case "status": {
        await say(`⎔ *EMORA Gateway (Slack)*\\nMode: ${this.turns.getMode(channelKey)}\\nSedang jalan: ${this.turns.isRunning(channelKey) ? "ya" : "tidak"}\\nTotal channel aktif: ${this.turns.activeChatCount()}`);
        return;
      }
      case "reset": {
        this._resetSessionFor(channelKey);
        await say("✔ Sesi direset — mulai obrolan baru dari nol.");
        return;
      }
      case "mode": {
        const val = (args[0] || "").toLowerCase();
        if (val !== "safe" && val !== "autonomous") {
          await say(`Mode saat ini: *${this.turns.getMode(channelKey)}*. Pakai \`/mode safe\` atau \`/mode autonomous\` buat ganti.`);
          return;
        }
        this.turns.setMode(channelKey, val);
        await say(`✔ Mode diganti ke *${val}*.`);
        return;
      }
      case "help":
        await say("⎔ *Perintah EMORA (Slack)*\n`/status` `/reset` `/mode <safe|autonomous>`\n`/<nama_skill>` — jalankan skill/command apa pun (bawaan/plugin) langsung\nKetik pesan biasa untuk ngobrol dengan EMORA.");
        return;
      default:
        await say(`ℹ Perintah \`/${cmd}\` gak dikenal.`);
    }
  }

  async _handlePrompt(message, say, channelKey) {
    const signal = this.turns.beginTurn(channelKey);
    const mode = this.turns.getMode(channelKey);
    const sessionId = this._sessionIdFor(channelKey);

    const progressLines = [];
    const onEvent = (ev) => {
      if (ev.type === "tool_use") progressLines.push(formatToolLine(ev.name, ev.args, ev.autoApproved));
      else if (ev.type === "tool_denied") progressLines.push(`▸ \`${ev.name}\` — ✘ ditolak`);
      else if (ev.type === "skill_read") progressLines.push(`▸ membaca skill: ${ev.name}`);
    };

    const onApproval = (toolName, args) => this._onApproval(say, channelKey, toolName, args);

    try {
      const llm = await this._getLLM();
      const result = await ask(llm, tools, sessionId, message.text, { onEvent, onApproval, mode, signal });
      let finalResponse = progressLines.length ? `_⚙️ Tools yang dipakai:\\n${progressLines.join('\\n')}_\\n\\n` : "";
      finalResponse += typeof result === "string" && result.trim() ? result : "⚠️ Agent tidak menghasilkan balasan.";
      
      for (const chunk of splitMessage(finalResponse)) {
        await say(chunk);
      }
      touchSession(sessionId).catch((err) => { console.error('[Ignored Error]', err.message); });
    } catch (err) {
      if (err?.aborted) await say("⏹ Dihentikan.");
      else await say(`✘ Error: ${err.message}`);
    } finally {
      this.turns.endTurn(channelKey);
      this.turns.touch(channelKey);
    }
  }

  async start(manager) {
    this._manager = manager;
    if (!this.config.botToken || !this.config.appToken) {
      console.log("[gateway:slack] Slack Bot Token atau App Token belum dikonfigurasi.");
      return;
    }

    this.app = new App({
      token: this.config.botToken,
      appToken: this.config.appToken,
      socketMode: true,
    });

    this.app.message(async ({ message, say }) => {
      if (message.bot_id || message.subtype) return; // ignore bot messages
      if (!this._isAllowed(message.user)) return;

      const channelKey = message.channel;
      const content = (message.text || "").trim();
      if (!content) return;

      if (content.startsWith("/")) {
        const args = content.slice(1).split(/\s+/).filter(Boolean);
        const cmd = (args[0] || "").toLowerCase();
        // Cek dulu apakah ini skill/command manual (bawaan/plugin, format
        // standar Claude Code — lihat core/skillRegistry.js) SEBELUM
        // memperlakukannya sbg command gateway bawaan (/status, /reset, dst).
        // resolveCandidates supaya kasus ambigu tetap diteruskan ke ask().
        const candidates = cmd && !RESERVED_GATEWAY_COMMANDS.has(cmd) ? await skillRegistry.resolveCandidates(cmd) : [];
        if (candidates.length) await this._handlePrompt(message, say, channelKey);
        else await this._handleCommand(say, channelKey, cmd, args.slice(1));
      } else {
        await this._handlePrompt(message, say, channelKey);
      }
    });

    // Handle generic button actions for approvals
    this.app.action(/emora_approve_.*/, async ({ body, action, ack, respond }) => {
      await ack();
      const nonce = action.value;
      const pending = this.pendingApprovals.get(body.channel.id);
      if (pending && pending.nonce === nonce) {
        this.pendingApprovals.delete(body.channel.id);
        await respond({ text: pending.content + "\\n\\n*✔ Disetujui*", replace_original: true });
        pending.resolve(true);
      }
    });

    this.app.action(/emora_deny_.*/, async ({ body, action, ack, respond }) => {
      await ack();
      const nonce = action.value;
      const pending = this.pendingApprovals.get(body.channel.id);
      if (pending && pending.nonce === nonce) {
        this.pendingApprovals.delete(body.channel.id);
        await respond({ text: pending.content + "\\n\\n*✘ Ditolak*", replace_original: true });
        pending.resolve(false);
      }
    });

    this._cleanupTimer = setInterval(() => this.turns.cleanupInactive(), 5 * 60 * 1000);
    await this.app.start();
    console.log("[gateway:slack] Terhubung ke Slack (Socket Mode).");
  }

  async stop() {
    if (this._cleanupTimer) clearInterval(this._cleanupTimer);
    if (this.app) {
      await this.app.stop();
      this.app = null;
    }
  }

  status() {
    return {
      running: !!this.app,
      platform: "slack",
      info: this.app ? `${this.turns.activeChatCount()} channel aktif` : "belum login",
    };
  }

  async sendText(chatId, text) {
    if (!this.app) throw new Error("Slack client belum aktif.");
    for (const chunk of splitMessage(text)) {
      await this.app.client.chat.postMessage({ channel: chatId, text: chunk });
    }
  }
}

registerAdapter("slack", (config) => new SlackGateway(config));
export { SlackGateway };
