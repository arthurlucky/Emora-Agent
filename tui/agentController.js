/**
 * tui/agentController.js
 *
 * Jembatan antara reducer (state.js, murni sinkron) dan core/chat.js
 * ask() (asinkron, event-driven). Semua efek samping & orkestrasi hidup
 * di sini; komponen React cukup panggil submit()/resolveApproval()/stop().
 */
import { ask } from "../core/chat.js";
import { touchSession } from "../core/sessionStore.js";

/**
 * @param {{dispatch: Function, getState: () => object, getLLM: () => any, tools: any[]}} deps
 */
async function processFileMentions(promptText) {
  const matches = promptText.match(/@([a-zA-Z0-9_\-./]+)/g);
  if (!matches?.length) return promptText;

  const fs = await import("fs/promises");
  let attachments = "";

  for (const m of matches) {
    const relPath = m.slice(1);
    try {
      const content = await fs.readFile(relPath, "utf8");
      const snippet = content.length > 8000 ? content.slice(0, 8000) + "\n... (truncated)" : content;
      attachments += `\n\n[FILE ATTACHMENT: ${relPath}]\n${snippet}`;
    } catch {}
  }

  return promptText + attachments;
}

export function createAgentController({ dispatch, getState, getLLM, tools }) {
  async function submit(text) {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    const state = getState();
    if (state.status !== "idle") return;

    const processedText = await processFileMentions(trimmed);
    const abortController = new AbortController();
    dispatch({ type: "SUBMIT_START", text: trimmed, abortController });

    const onEvent = (ev) => {
      if (ev.type === "tool_use") dispatch({ type: "AGENT_TOOL_USE", name: ev.name, args: ev.args, autoApproved: ev.autoApproved });
      else if (ev.type === "tool_result") dispatch({ type: "AGENT_TOOL_RESULT", name: ev.name, durationMs: ev.durationMs });
      else if (ev.type === "tool_denied") dispatch({ type: "AGENT_TOOL_DENIED", name: ev.name });
      else if (ev.type === "skill_read") dispatch({ type: "AGENT_SKILL_READ", name: ev.name });
    };

    const onApproval = (toolName, args) =>
      new Promise((resolve) => {
        dispatch({ type: "APPROVAL_REQUEST", payload: { toolName, args, resolve } });
      });

    // STREAMING: kalau LLM support .stream() & tidak sedang tool-loop,
    // tampilkan jawaban token-by-token. Fallback ke ask() biasa kalau
    // streaming gagal — perilaku lama tetap aman.
    const useStream = getState().streamEnabled && !trimmed.startsWith("/");
    if (useStream) {
      // BUGFIX (kelap-kelip pas AI merespon): sebagian provider ngirim chunk
      // kecil dgn frekuensi tinggi (bisa puluhan per detik). Dispatch tiap
      // chunk = re-render Ink FULL-SCREEN tiap chunk (Ink nge-erase & nulis
      // ulang seluruh layar tiap render, gak diff per-baris) = TUI
      // kelap-kelip parah pas streaming. Chunk ditampung dulu di buffer &
      // di-flush ke reducer maks tiap STREAM_FLUSH_MS — masih kerasa
      // "ngetik" real-time buat mata, tapi jumlah repaint layar/detik jauh
      // lebih ringan.
      const STREAM_FLUSH_MS = 80;
      let buffer = "";
      let flushTimer = null;
      const flush = () => {
        flushTimer = null;
        if (!buffer) return;
        const text = buffer;
        buffer = "";
        dispatch({ type: "STREAM_CHUNK", text });
      };
      const scheduleFlush = () => {
        if (flushTimer) return;
        flushTimer = setTimeout(flush, STREAM_FLUSH_MS);
      };
      try {
        const { getSystemPrompt } = await import("../core/chat.js");
        const { SystemMessage, HumanMessage } = await import("@langchain/core/messages");
        const sys = await getSystemPrompt();
        dispatch({ type: "STREAM_START" });
        const stream = await getLLM().stream([
          new SystemMessage(sys),
          new HumanMessage(processedText),
        ], { signal: abortController.signal });
        for await (const chunk of stream) {
          if (abortController.signal.aborted) break;
          const piece = typeof chunk.content === "string" ? chunk.content : "";
          if (piece) { buffer += piece; scheduleFlush(); }
        }
        clearTimeout(flushTimer);
        flush(); // pastikan sisa buffer tampil sebelum STREAM_END
        dispatch({ type: "STREAM_END" });
        touchSession(state.sessionId, trimmed.slice(0, 200)).catch(() => {});
        return;
      } catch (err) {
        clearTimeout(flushTimer);
        flush();
        dispatch({ type: "STREAM_END" });
        if (abortController.signal.aborted) { dispatch({ type: "AGENT_ABORTED" }); return; }
        console.warn(`[tui] Streaming gagal (${err.message}), beralih ke mode ask() standar...`);
        // gagal streaming → jatuh ke jalur ask() penuh di bawah
      }
    }

    try {
      const result = await ask(getLLM(), tools, state.sessionId, processedText, {
        onEvent,
        onApproval,
        mode: getState().mode,
        signal: abortController.signal,
      });
      const content = typeof result === "string" && result.trim()
        ? result
        : String(result?.content ?? result ?? "").trim() || "(tidak ada balasan dari agent)";
      dispatch({ type: "AGENT_MESSAGE", content });
      // Kirim prompt pertama sebagai bahan auto-title (lihat sessionStore.touchSession).
      touchSession(state.sessionId, trimmed.slice(0, 200)).catch(() => {});
    } catch (err) {
      if (err?.aborted) dispatch({ type: "AGENT_ABORTED" });
      else dispatch({ type: "AGENT_ERROR", message: err?.message || String(err) });
    }
  }

  function resolveApproval(value) {
    const state = getState();
    if (state.approval?.resolve) {
      state.approval.resolve(value);
      dispatch({ type: "APPROVAL_RESOLVE" });
    }
  }

  function stop() {
    const state = getState();
    // BUGFIX (stuck, gak bisa keluar): kalau lagi approval_pending, ask() di
    // core/chat.js nyangkut di `await onApproval(...)` — satu-satunya cara
    // ngelepas promise itu ya lewat resolveApproval(), abort() sendirian
    // gak cukup karena tool-loop baru ngecek signal.aborted SETELAH
    // approval-nya kejawab. Makanya approval ditolak dulu di sini sebelum
    // abort, supaya ask() gak nyangkut selamanya nunggu jawaban yang gak
    // akan pernah datang lewat Ctrl+C.
    if (state.approval?.resolve) resolveApproval(false);
    if (state.abortController) state.abortController.abort();
  }

  return { submit, resolveApproval, stop };
}
