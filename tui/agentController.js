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
export function createAgentController({ dispatch, getState, getLLM, tools }) {
  async function submit(text) {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    const state = getState();
    if (state.status !== "idle") return;

    const abortController = new AbortController();
    dispatch({ type: "SUBMIT_START", text: trimmed, abortController });

    const onEvent = (ev) => {
      if (ev.type === "tool_use") dispatch({ type: "AGENT_TOOL_USE", name: ev.name, autoApproved: ev.autoApproved });
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
      try {
        const { getSystemPrompt } = await import("../core/chat.js");
        const { SystemMessage, HumanMessage } = await import("@langchain/core/messages");
        const sys = await getSystemPrompt();
        dispatch({ type: "STREAM_START" });
        const stream = await getLLM().stream([
          new SystemMessage(sys),
          new HumanMessage(trimmed),
        ]);
        for await (const chunk of stream) {
          if (abortController.signal.aborted) break;
          const piece = typeof chunk.content === "string" ? chunk.content : "";
          if (piece) dispatch({ type: "STREAM_CHUNK", text: piece });
        }
        dispatch({ type: "STREAM_END" });
        touchSession(state.sessionId, trimmed.slice(0, 200)).catch(() => {});
        return;
      } catch (err) {
        dispatch({ type: "STREAM_END" });
        if (err?.aborted || err?.name === "AbortError") { dispatch({ type: "AGENT_ABORTED" }); return; }
        // gagal streaming → jatuh ke jalur ask() penuh di bawah
      }
    }

    try {
      const result = await ask(getLLM(), tools, state.sessionId, trimmed, {
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
    if (state.abortController) state.abortController.abort();
  }

  return { submit, resolveApproval, stop };
}
