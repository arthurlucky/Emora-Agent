/**
 * gateway/matrix/index.js
 *
 * Adapter Matrix untuk EMORA gateway.
 * Menggunakan matrix-js-sdk.
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const sdk = require("matrix-js-sdk");
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
const MATRIX_LIMIT = 3000;
function splitMessage(text, limit = MATRIX_LIMIT) {
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

const RESERVED_GATEWAY_COMMANDS = new Set(["status", "reset", "yes", "no", "mode", "help"]);

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const SESSION_MAP_FILE = path.resolve("./gateway/matrix/session-map.json");

function loadSessionMap() {
  try { return JSON.parse(fs.readFileSync(SESSION_MAP_FILE, "utf8")); } catch { return {}; }
}
function saveSessionMap(map) {
  fs.mkdirSync(path.dirname(SESSION_MAP_FILE), { recursive: true });
  fs.writeFileSync(SESSION_MAP_FILE, JSON.stringify(map, null, 2));
}

class MatrixGateway {
  constructor(config) {
    this.config = config;
    this.client = null;
    this.turns = new TurnStateManager("matrix");
    this.sessionMap = loadSessionMap(); 
    this.pendingApprovals = new Map();
    this._llmPromise = null;
    this._cleanupTimer = null;
  }

  name() { return "matrix"; }

  async _getLLM() {
    if (!this._llmPromise) this._llmPromise = createLLM(tools);
    return this._llmPromise;
  }

  _sessionIdFor(roomId) {
    let id = this.sessionMap[roomId];
    if (!id) {
      id = crypto.randomUUID();
      this.sessionMap[roomId] = id;
      saveSessionMap(this.sessionMap);
    }
    return id;
  }

  _resetSessionFor(roomId) {
    const id = crypto.randomUUID();
    this.sessionMap[roomId] = id;
    saveSessionMap(this.sessionMap);
    return id;
  }

  _isAllowed(userId) {
    const list = this.config.allowedUsers || [];
    return list.length === 0 || list.includes(userId);
  }

  async _onApproval(roomId, toolName, args) {
    const nonce = crypto.randomUUID();
    const content = approvalContent(toolName, args);
    const text = `${content}\\n\\nKetik "/yes" untuk mengizinkan atau "/no" untuk menolak (Sesi: ${nonce.substring(0, 8)}).`;

    await this.sendText(roomId, text);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(roomId);
        this.sendText(roomId, "⏱ *Timeout — aksi otomatis ditolak.*").catch((err) => { console.error('[Ignored Error]', err.message); });
        resolve(false);
      }, APPROVAL_TIMEOUT_MS);

      this.pendingApprovals.set(roomId, {
        nonce,
        content,
        resolve: (val) => { clearTimeout(timeout); resolve(val); },
      });
    });
  }

  async _handleCommand(roomId, cmd, args) {
    switch (cmd) {
      case "status": {
        await this.sendText(roomId, `⎔ *EMORA Gateway (Matrix)*\\nMode: ${this.turns.getMode(roomId)}\\nSedang jalan: ${this.turns.isRunning(roomId) ? "ya" : "tidak"}\\nTotal chat aktif: ${this.turns.activeChatCount()}`);
        return;
      }
      case "reset": {
        this._resetSessionFor(roomId);
        await this.sendText(roomId, "✔ Sesi direset — mulai obrolan baru dari nol.");
        return;
      }
      case "yes":
      case "no": {
        const pending = this.pendingApprovals.get(roomId);
        if (!pending) {
          await this.sendText(roomId, "ℹ Gak ada approval yang lagi nunggu di channel ini.");
          return;
        }
        this.pendingApprovals.delete(roomId);
        const approved = cmd === "yes";
        pending.resolve(approved);
        await this.sendText(roomId, pending.content + `\\n\\n${approved ? "✔ Disetujui" : "✘ Ditolak"}`);
        return;
      }
      case "mode": {
        const val = (args[0] || "").toLowerCase();
        if (val !== "safe" && val !== "autonomous") {
          await this.sendText(roomId, `Mode saat ini: *${this.turns.getMode(roomId)}*. Pakai \`/mode safe\` atau \`/mode autonomous\` buat ganti.`);
          return;
        }
        this.turns.setMode(roomId, val);
        await this.sendText(roomId, `✔ Mode diganti ke *${val}*.`);
        return;
      }
      case "help":
        await this.sendText(roomId, "⎔ *Perintah EMORA (Matrix)*\\n`/status` `/reset` `/mode <safe|autonomous>`\\n`/yes` `/no`\\n`/<nama_skill>` — jalankan skill/command apa pun (bawaan/plugin) langsung");
        return;
      default: {
        // Bukan salah satu command bawaan gateway di atas — sudah dicek
        // skillRegistry di routing atas (Room.timeline), jadi kalau sampai
        // ke sini berarti memang benar-benar tidak dikenal.
        await this.sendText(roomId, `ℹ Perintah \`/${cmd}\` gak dikenal.`);
      }
    }
  }

  async _handlePrompt(roomId, content) {
    const signal = this.turns.beginTurn(roomId);
    const mode = this.turns.getMode(roomId);
    const sessionId = this._sessionIdFor(roomId);

    const progressLines = [];
    const onEvent = (ev) => {
      if (ev.type === "tool_use") progressLines.push(formatToolLine(ev.name, ev.args, ev.autoApproved));
      else if (ev.type === "tool_denied") progressLines.push(`▸ \`${ev.name}\` — ✘ ditolak`);
      else if (ev.type === "skill_read") progressLines.push(`▸ membaca skill: ${ev.name}`);
    };

    const onApproval = (toolName, args) => this._onApproval(roomId, toolName, args);

    try {
      const llm = await this._getLLM();
      const result = await ask(llm, tools, sessionId, content, { onEvent, onApproval, mode, signal });
      let finalResponse = progressLines.length ? `*Tools yang dipakai:*\\n${progressLines.join('\\n')}\\n\\n` : "";
      finalResponse += typeof result === "string" && result.trim() ? result : "⚠️ Agent tidak menghasilkan balasan.";
      
      for (const chunk of splitMessage(finalResponse)) {
        await this.sendText(roomId, chunk);
      }
      touchSession(sessionId).catch((err) => { console.error('[Ignored Error]', err.message); });
    } catch (err) {
      if (err?.aborted) await this.sendText(roomId, "⏹ Dihentikan.");
      else await this.sendText(roomId, `✘ Error: ${err.message}`);
    } finally {
      this.turns.endTurn(roomId);
      this.turns.touch(roomId);
    }
  }

  async start(manager) {
    this._manager = manager;
    if (!this.config.baseUrl || !this.config.accessToken || !this.config.userId) {
      console.log("[gateway:matrix] Konfigurasi Matrix tidak lengkap.");
      return;
    }

    this.client = sdk.createClient({
      baseUrl: this.config.baseUrl,
      accessToken: this.config.accessToken,
      userId: this.config.userId,
    });

    this.client.on("Room.timeline", async (event, room, toStartOfTimeline) => {
      if (toStartOfTimeline) return;
      if (event.getType() !== "m.room.message") return;
      if (event.getSender() === this.client.getUserId()) return;
      
      const contentObj = event.getContent();
      if (contentObj.msgtype !== "m.text") return;

      const content = (contentObj.body || "").trim();
      if (!content) return;
      if (!this._isAllowed(event.getSender())) return;

      const roomId = room.roomId;

      if (content.startsWith("/")) {
        const args = content.slice(1).split(/\s+/).filter(Boolean);
        const cmd = (args[0] || "").toLowerCase();
        // Cek dulu apakah ini skill/command manual (bawaan/plugin, format
        // standar Claude Code — lihat core/skillRegistry.js) SEBELUM
        // memperlakukannya sbg command gateway bawaan (/status, /reset, dst).
        // resolveCandidates supaya kasus ambigu tetap diteruskan ke ask().
        const candidates = cmd && !RESERVED_GATEWAY_COMMANDS.has(cmd) ? await skillRegistry.resolveCandidates(cmd) : [];
        if (candidates.length) await this._handlePrompt(roomId, content);
        else await this._handleCommand(roomId, cmd, args.slice(1));
      } else {
        await this._handlePrompt(roomId, content);
      }
    });

    this._cleanupTimer = setInterval(() => this.turns.cleanupInactive(), 5 * 60 * 1000);
    await this.client.startClient({ initialSyncLimit: 1 });
    console.log("[gateway:matrix] Terhubung ke Matrix.");
  }

  async stop() {
    if (this._cleanupTimer) clearInterval(this._cleanupTimer);
    if (this.client) {
      this.client.stopClient();
      this.client = null;
    }
  }

  status() {
    return {
      running: !!this.client,
      platform: "matrix",
      info: this.client ? `${this.turns.activeChatCount()} chat aktif` : "belum login",
    };
  }

  async sendText(chatId, text) {
    if (!this.client) throw new Error("Matrix client belum aktif.");
    for (const chunk of splitMessage(text)) {
      await this.client.sendEvent(chatId, "m.room.message", {
        msgtype: "m.text",
        body: chunk,
      });
    }
  }
}

registerAdapter("matrix", (config) => new MatrixGateway(config));
export { MatrixGateway };
