/**
 * core/ag_subagent_engine.js
 *
 * Subagent Engine untuk EMORA — terinspirasi arsitektur Antigravity CLI.
 *
 * Fitur utama:
 *   - Asinkron fire-and-forget (tidak memblokir main agent)
 *   - EventEmitter untuk integrasi TUI tanpa console.log
 *   - Dedup otomatis (mencegah spawn duplikat dalam 30s window)
 *   - Timeout otomatis (default 2 menit, configurable)
 *   - Memory compaction (mencegah OOM pada loop panjang)
 *   - Short ID 8 karakter (mudah dibaca)
 *   - Error boundary menyeluruh (tidak ada crash .message pada undefined)
 *   - Auto-cleanup subagent selesai setelah 5 menit
 *   - Rate limit: maksimal 5 subagent bersamaan
 *
 * Tools diambil secara lazy dari core/tools.js (dynamic import, bukan static)
 * untuk menghindari circular dependency.
 */

import crypto from "crypto";
import { EventEmitter } from "events";
import { createLLM } from "../provider/index.js";
import {
  SystemMessage,
  HumanMessage,
  ToolMessage,
} from "@langchain/core/messages";

// ── Konstanta ────────────────────────────────────────────────────────────────
const DEFAULT_TIMEOUT_MS = 120_000; // 2 menit
const MAX_ITERATIONS = 20; // maks iterasi tool per sesi
const MAX_MEMORY_MSGS = 50; // maks pesan sebelum compaction
const DEDUP_WINDOW_MS = 30_000; // 30 detik anti-spam
const MAX_CONCURRENT = 5; // maks subagent bersamaan
const CLEANUP_INTERVAL = 300_000; // 5 menit
const TOOL_OUTPUT_CAP = 8_000; // truncate output tool > ini

// ── Tool blocklist (subagent tidak boleh punya ini) ─────────────────────────
const BLOCKED_TOOLS = new Set([
  "invoke_subagent",
  "send_message",
  "manage_subagents",
  "delegate_to_swarm",
]);

// ─────────────────────────────────────────────────────────────────────────────
// SubagentEngine — Singleton EventEmitter
// ─────────────────────────────────────────────────────────────────────────────
class SubagentEngine extends EventEmitter {
  constructor() {
    super();
    this._agents = new Map(); // id → ctx
    this._inbox = new Map(); // id → [{text, time}]
    this._hashes = new Map(); // hash → {id, time}
    this._toolsCache = null; // cached tools array
    this._toolsCacheTime = 0;
  }

  // ── Helper: short random ID ──────────────────────────────────────────────
  _id() {
    return crypto.randomBytes(4).toString("hex"); // 8 hex chars
  }

  // ── Helper: dedup hash ───────────────────────────────────────────────────
  _hash(role, prompt) {
    return crypto
      .createHash("md5")
      .update(`${role}::${prompt}`)
      .digest("hex")
      .slice(0, 12);
  }

  // ── Helper: ambil tools (lazy, cached 60s) ───────────────────────────────
  async _getTools() {
    const now = Date.now();
    if (this._toolsCache && now - this._toolsCacheTime < 60_000) {
      return this._toolsCache;
    }
    try {
      const mod = await import("./tools.js");
      const all = mod.default || [];
      this._toolsCache = all.filter((t) => !BLOCKED_TOOLS.has(t.name));
      this._toolsCacheTime = now;
      return this._toolsCache;
    } catch {
      return [];
    }
  }

  // ── Helper: system prompt subagent ───────────────────────────────────────
  _buildPrompt(id, role) {
    return `Kamu adalah Subagent EMORA yang berjalan di background.
ID: ${id} | Peran: ${role}

ATURAN:
1. Kamu adalah worker mandiri. Selesaikan tugas yang diberikan dengan AKSI NYATA menggunakan tools yang tersedia.
2. JANGAN PERNAH mengatakan "sudah selesai" atau "file sudah dibuat" TANPA benar-benar mengeksekusi tool yang relevan terlebih dahulu.
3. Jika tool yang kamu butuhkan tidak tersedia, katakan terus terang. JANGAN mengarang hasil.
4. Saat benar-benar selesai, berikan ringkasan FAKTA: tool apa yang dipanggil, file apa yang dibuat/diubah, dan hasilnya.
5. Jawab dalam bahasa yang sama dengan instruksi yang diberikan.`;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Luncurkan subagent baru di background.
   * @returns {{ id: string, deduped: boolean }}
   */
  async spawn({ role, prompt, timeoutMs }) {
    // ─── Guard: concurrent limit ───────────────────────────────────────
    const running = Array.from(this._agents.values()).filter(
      (a) => a.status === "running"
    );
    if (running.length >= MAX_CONCURRENT) {
      throw new Error(
        `Batas ${MAX_CONCURRENT} subagent bersamaan tercapai. Kill yang sudah selesai dulu.`
      );
    }

    // ─── Guard: dedup ──────────────────────────────────────────────────
    const hash = this._hash(role, prompt);
    const prev = this._hashes.get(hash);
    if (prev && Date.now() - prev.time < DEDUP_WINDOW_MS) {
      return { id: prev.id, deduped: true };
    }

    // ─── Build context ─────────────────────────────────────────────────
    const id = this._id();
    const controller = new AbortController();
    const tools = await this._getTools();
    const timeout = timeoutMs || DEFAULT_TIMEOUT_MS;

    let llm;
    try {
      llm = await createLLM(tools);
    } catch (err) {
      throw new Error(
        `Gagal membuat LLM untuk subagent: ${err?.message || String(err)}`
      );
    }

    const ctx = {
      id,
      role,
      promptPreview: prompt.slice(0, 80),
      status: "running", // running | done | error | timeout | killed
      startedAt: Date.now(),
      llm,
      tools,
      memory: [new SystemMessage(this._buildPrompt(id, role))],
      controller,
      timeoutTimer: null,
      toolsUsed: [],
      error: null,
    };

    // ─── Timeout timer ─────────────────────────────────────────────────
    ctx.timeoutTimer = setTimeout(() => {
      if (ctx.status !== "running") return;
      controller.abort();
      ctx.status = "timeout";
      this._deliver(
        id,
        `[TIMEOUT] Subagent ${id} dihentikan otomatis setelah ${Math.round(timeout / 1000)}s.`
      );
      this.emit("timeout", { id, role });
    }, timeout);

    // ─── Register ──────────────────────────────────────────────────────
    this._agents.set(id, ctx);
    this._hashes.set(hash, { id, time: Date.now() });
    this.emit("spawn", { id, role, prompt: ctx.promptPreview });

    // ─── Fire and forget ───────────────────────────────────────────────
    this._loop(ctx, prompt)
      .catch((err) => {
        if (ctx.status === "running") {
          ctx.status = "error";
          ctx.error = err?.message || String(err);
          this._deliver(id, `[ERROR] Subagent crash: ${ctx.error}`);
          this.emit("error", { id, error: ctx.error });
        }
      })
      .finally(() => {
        if (ctx.timeoutTimer) {
          clearTimeout(ctx.timeoutTimer);
          ctx.timeoutTimer = null;
        }
      });

    return { id, deduped: false };
  }

  /**
   * Baca semua pesan dari inbox subagent (destructive read / pop).
   */
  readInbox(id) {
    const msgs = this._inbox.get(id) || [];
    this._inbox.set(id, []);
    return msgs.map((m) => m.text);
  }

  /**
   * Peek jumlah pesan unread tanpa mengkonsumsi.
   */
  peekInbox(id) {
    return (this._inbox.get(id) || []).length;
  }

  /**
   * List semua subagent (aktif maupun selesai).
   */
  list() {
    return Array.from(this._agents.values()).map((a) => ({
      id: a.id,
      role: a.role,
      promptPreview: a.promptPreview,
      status: a.status,
      startedAt: a.startedAt,
      elapsed: Math.floor((Date.now() - a.startedAt) / 1000),
      toolsUsed: [...new Set(a.toolsUsed)],
      unread: this.peekInbox(a.id),
      error: a.error,
    }));
  }

  /**
   * Kill subagent by ID.
   */
  kill(id) {
    const a = this._agents.get(id);
    if (!a) return false;
    a.controller.abort();
    if (a.timeoutTimer) {
      clearTimeout(a.timeoutTimer);
      a.timeoutTimer = null;
    }
    a.status = "killed";
    this.emit("killed", { id, role: a.role });
    return true;
  }

  /**
   * Kill semua subagent.
   */
  killAll() {
    let count = 0;
    for (const [id] of this._agents) {
      if (this.kill(id)) count++;
    }
    return count;
  }

  /**
   * Kirim instruksi baru ke subagent yang idle/done.
   */
  sendMessage(id, message) {
    const a = this._agents.get(id);
    if (!a) throw new Error(`Subagent ${id} tidak ditemukan.`);
    if (a.status === "running")
      throw new Error(`Subagent ${id} sedang sibuk, tunggu sampai selesai.`);
    if (a.status === "killed" || a.status === "timeout")
      throw new Error(`Subagent ${id} sudah mati (${a.status}).`);

    // Reactivate
    a.status = "running";
    a.startedAt = Date.now();
    a.error = null;

    // Reset abort controller (yang lama mungkin sudah aborted)
    a.controller = new AbortController();

    // Reset timeout
    a.timeoutTimer = setTimeout(() => {
      if (a.status !== "running") return;
      a.controller.abort();
      a.status = "timeout";
      this._deliver(id, `[TIMEOUT] Subagent ${id} timeout.`);
    }, DEFAULT_TIMEOUT_MS);

    this._loop(a, message)
      .catch((err) => {
        if (a.status === "running") {
          a.status = "error";
          a.error = err?.message || String(err);
          this._deliver(id, `[ERROR] ${a.error}`);
        }
      })
      .finally(() => {
        if (a.timeoutTimer) {
          clearTimeout(a.timeoutTimer);
          a.timeoutTimer = null;
        }
      });
  }

  /**
   * Bersihkan subagent lama yang sudah selesai.
   */
  cleanup() {
    const now = Date.now();
    const terminal = new Set(["done", "error", "killed", "timeout"]);
    for (const [id, a] of this._agents) {
      if (terminal.has(a.status) && now - a.startedAt > CLEANUP_INTERVAL) {
        this._agents.delete(id);
        // Inbox dipertahankan sedikit lebih lama (bisa dibaca user)
      }
    }
    // Bersihkan hash lama
    for (const [hash, entry] of this._hashes) {
      if (now - entry.time > 60_000) this._hashes.delete(hash);
    }
    // Bersihkan inbox tanpa parent
    for (const [id] of this._inbox) {
      if (!this._agents.has(id) && (this._inbox.get(id) || []).length === 0) {
        this._inbox.delete(id);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INTERNAL
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Main agent loop — berjalan di background.
   */
  async _loop(ctx, userMessage) {
    if (ctx.controller.signal.aborted) return;
    ctx.status = "running";

    ctx.memory.push(new HumanMessage(userMessage));

    let iterations = 0;

    while (iterations++ < MAX_ITERATIONS) {
      if (ctx.controller.signal.aborted) break;

      // ─── Memory compaction ───────────────────────────────────────────
      if (ctx.memory.length > MAX_MEMORY_MSGS) {
        const sys = ctx.memory[0];
        const recent = ctx.memory.slice(-20);
        ctx.memory = [
          sys,
          new HumanMessage(
            "[CONTEXT COMPACTED] Pesan-pesan sebelumnya telah diringkas untuk menghemat memori. Lanjutkan tugasmu."
          ),
          ...recent,
        ];
      }

      // ─── LLM invoke ─────────────────────────────────────────────────
      let response;
      try {
        response = await ctx.llm.invoke(ctx.memory, {
          signal: ctx.controller.signal,
        });
      } catch (err) {
        // Jika abort (timeout/kill), keluar diam-diam
        if (ctx.controller.signal.aborted) return;
        throw err;
      }

      ctx.memory.push(response);

      // ─── Final answer (tidak ada tool calls) ─────────────────────────
      if (!response.tool_calls || response.tool_calls.length === 0) {
        let content =
          typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);
        if (!content) content = response.text || "(kosong)";

        ctx.status = "done";
        this._deliver(ctx.id, content);
        this.emit("done", { id: ctx.id, role: ctx.role });
        return;
      }

      // ─── Execute tools ───────────────────────────────────────────────
      this.emit("tools", {
        id: ctx.id,
        tools: response.tool_calls.map((t) => t.name),
      });

      for (const tc of response.tool_calls) {
        if (ctx.controller.signal.aborted) break;

        const tool = ctx.tools.find((t) => t.name === tc.name);
        if (!tool) {
          ctx.memory.push(
            new ToolMessage({
              tool_call_id: tc.id,
              content: `Error: Tool "${tc.name}" tidak tersedia untuk subagent.`,
            })
          );
          continue;
        }

        ctx.toolsUsed.push(tc.name);

        try {
          const result = await tool.invoke(tc.args, {
            signal: ctx.controller.signal,
          });
          let resultStr =
            typeof result === "string" ? result : JSON.stringify(result);

          // Truncate output besar
          if (resultStr.length > TOOL_OUTPUT_CAP) {
            const half = Math.floor(TOOL_OUTPUT_CAP / 2);
            resultStr =
              resultStr.slice(0, half) +
              "\n...[TRUNCATED]...\n" +
              resultStr.slice(-half);
          }

          ctx.memory.push(
            new ToolMessage({ tool_call_id: tc.id, content: resultStr })
          );
        } catch (err) {
          ctx.memory.push(
            new ToolMessage({
              tool_call_id: tc.id,
              content: `Error: ${err?.message || String(err)}`,
            })
          );
        }
      }
    }

    // Batas iterasi tercapai
    ctx.status = "done";
    const usedStr = [...new Set(ctx.toolsUsed)].join(", ") || "(tidak ada)";
    this._deliver(
      ctx.id,
      `[SYSTEM] Subagent selesai setelah ${iterations - 1} iterasi tool.\nTools digunakan: ${usedStr}`
    );
    this.emit("done", { id: ctx.id, role: ctx.role });
  }

  /**
   * Kirim pesan ke inbox main agent.
   */
  _deliver(id, text) {
    if (!this._inbox.has(id)) this._inbox.set(id, []);
    this._inbox.get(id).push({ text, time: Date.now() });
    this.emit("inbox", { id, preview: text.slice(0, 120) });
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────
const engine = new SubagentEngine();

// Auto-cleanup setiap 5 menit
const _cleanupTimer = setInterval(() => engine.cleanup(), CLEANUP_INTERVAL);
if (_cleanupTimer.unref) _cleanupTimer.unref();

export default engine;

// ── Named exports (backward compat + TUI) ────────────────────────────────────
export const getActiveSubagents = () => engine.list();
