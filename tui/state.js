/**
 * tui/state.js
 *
 * State + reducer terpusat buat TUI. Semua perubahan state SINKRON lewat
 * reducer ini; orkestrasi ASINKRON (panggil agent, approval, dsb) hidup di
 * tui/agentController.js yang men-dispatch action-action di bawah ini
 * seiring event terjadi.
 */
import crypto from "crypto";
import { C } from "./styles.js";

export function createInitialState({ sessionId, sessionTitle, provider, columns, rows, initialMode }) {
  return {
    view: "chat", // chat | history | skills | wizard | tasks | gatewayStatus
    sessionId,
    sessionTitle: sessionTitle || "Sesi baru",

    messages: [], // {id, role, content, toolCalls: [{name,args,result,status}]}
    input: "",
    cursorPos: 0,

    status: "idle", // idle | thinking | approval_pending | chain_limit_pending | ask_user_pending
    spinnerTick: 0,
    turnStartedAt: null,
    progressLines: [], // baris "▸ tool(...)" yang lagi berjalan turn ini
    scrollOffset: 0, // 0 = nempel ke bawah (paling baru)

    approval: null, // {toolName, args, resolve, options}
    chainLimit: null, // {resolve}
    askUser: null, // {question, resolve}

    mode: initialMode || (process.env.DEFAULT_MODE === "safe" ? "safe" : "autonomous"), // safe | autonomous | plan
    agentMode: process.env.DEFAULT_AGENTMODE || "chat", // chat | simple | planned | deep (informational, lihat catatan di agentController.js)
    streamEnabled: process.env.DEFAULT_STREAM === "true",

    suggestions: null, // array string | null
    suggestionIndex: 0,
    mentionSuggestions: null, // buat @file mention

    provider: provider || { name: "-", model: "-" },

    history: null, // {sessions:[...], index}
    skills: null, // {list:[...], index}
    wizard: null, // {step, data}
    gatewayStatus: null, // {platforms:{...}}
    tasks: null, // {list:[...]}

    error: null,
    notice: null, // pesan info sementara (mis. "Mode diganti ke autonomous")

    abortController: null,
    terminalSize: { columns: columns || 80, rows: rows || 24 },

    quit: false,
  };
}

export function addMessage(state, msg) {
  return {
    ...state,
    messages: [...state.messages, { id: crypto.randomUUID(), toolCalls: [], ...msg }],
  };
}

function updateLastMessage(state, updater) {
  if (!state.messages.length) return state;
  const messages = state.messages.slice();
  messages[messages.length - 1] = updater(messages[messages.length - 1]);
  return { ...state, messages };
}

export function reducer(state, action) {
  switch (action.type) {
    case "SET_INPUT":
      return { ...state, input: action.value, cursorPos: action.cursorPos ?? action.value.length };

    case "SET_CURSOR":
      return { ...state, cursorPos: action.pos };

    case "SET_VIEW":
      return { ...state, view: action.view, error: null, notice: null };

    case "SET_TERMINAL_SIZE":
      return { ...state, terminalSize: { columns: action.columns, rows: action.rows } };

    case "SUBMIT_START": {
      const withUserMsg = addMessage(state, { role: "user", content: action.text });
      return {
        ...withUserMsg,
        input: "",
        cursorPos: 0,
        status: "thinking",
        turnStartedAt: Date.now(),
        progressLines: [],
        suggestions: null,
        abortController: action.abortController,
        error: null,
        scrollOffset: 0,
      };
    }

    case "AGENT_TOOL_USE": {
      // Ala Hermes: bullet dim + nama tool, tanpa noise "(auto)".
      const line = C.faint("▸ ") + C.dim(action.name);
      return { ...state, progressLines: [...state.progressLines.slice(-30), line] };
    }

    case "AGENT_TOOL_DENIED": {
      return { ...state, progressLines: [...state.progressLines.slice(-30), C.red("✘ " + action.name + " ditolak")] };
    }

    case "AGENT_SKILL_READ": {
      return { ...state, progressLines: [...state.progressLines.slice(-30), C.purple("◈ skill: " + action.name)] };
    }

    case "AGENT_MESSAGE": {
      const cleared = { ...state, status: "idle", progressLines: [], abortController: null };
      return addMessage(cleared, { role: "assistant", content: action.content });
    }

    // ── STREAMING ──────────────────────────────────────────────────────────
    case "STREAM_START": {
      const started = { ...state, status: "thinking" };
      return addMessage(started, { role: "assistant", content: "" });
    }
    case "STREAM_CHUNK": {
      // Append ke pesan assistant terakhir (yang dibuat STREAM_START).
      if (!state.messages.length) return state;
      const last = state.messages[state.messages.length - 1];
      if (last.role !== "assistant") return state;
      const updated = { ...last, content: last.content + action.text };
      return { ...state, messages: [...state.messages.slice(0, -1), updated], scrollOffset: 0 };
    }
    case "STREAM_END": {
      // Buang pesan streaming kosong (mis. dibatalkan sebelum token pertama).
      const msgs = state.messages.filter((m, i) =>
        !(i === state.messages.length - 1 && m.role === "assistant" && !m.content));
      return { ...state, status: "idle", progressLines: [], abortController: null, messages: msgs };
    }

    case "AGENT_ERROR": {
      return { ...state, status: "idle", progressLines: [], abortController: null, error: action.message };
    }

    case "AGENT_ABORTED": {
      return { ...state, status: "idle", progressLines: [], abortController: null, notice: "Dihentikan." };
    }

    case "APPROVAL_REQUEST":
      return { ...state, status: "approval_pending", approval: { ...action.payload } };

    case "APPROVAL_RESOLVE":
      return { ...state, status: "thinking", approval: null };

    case "ASK_USER_REQUEST":
      return { ...state, status: "ask_user_pending", askUser: { ...action.payload } };

    case "ASK_USER_RESOLVE":
      return { ...state, status: "thinking", askUser: null };

    case "SPINNER_TICK":
      return { ...state, spinnerTick: state.spinnerTick + 1 };

    case "SET_MODE":
      return { ...state, mode: action.mode, notice: `Mode diganti ke ${action.mode}.` };

    case "SET_AGENT_MODE":
      return { ...state, agentMode: action.agentMode, notice: `Agent mode diganti ke ${action.agentMode}.` };

    case "TOGGLE_STREAM":
      return { ...state, streamEnabled: !state.streamEnabled, notice: `Streaming ${!state.streamEnabled ? "diaktifkan" : "dimatikan"}.` };

    case "SET_PROVIDER":
      return { ...state, provider: action.provider, notice: `Provider diganti ke ${action.provider.name} (${action.provider.model}).` };

    case "SET_SUGGESTIONS":
      return { ...state, suggestions: action.suggestions, suggestionIndex: 0 };

    case "MOVE_SUGGESTION": {
      if (!state.suggestions?.length) return state;
      const len = state.suggestions.length;
      const idx = (state.suggestionIndex + action.delta + len) % len;
      return { ...state, suggestionIndex: idx };
    }

    case "CLEAR_SUGGESTIONS":
      return { ...state, suggestions: null, suggestionIndex: 0 };

    case "NEW_SESSION":
      return {
        ...state,
        sessionId: action.sessionId,
        sessionTitle: action.sessionTitle || "Sesi baru",
        messages: [],
        error: null,
        notice: "Sesi baru dimulai.",
        view: "chat",
      };

    case "LOAD_SESSION":
      return {
        ...state,
        sessionId: action.sessionId,
        sessionTitle: action.sessionTitle,
        messages: action.messages,
        view: "chat",
        notice: `Sesi "${action.sessionTitle}" dimuat.`,
      };

    case "SET_HISTORY_VIEW":
      return { ...state, view: "history", history: { sessions: action.sessions, index: 0 } };

    case "MOVE_HISTORY_SELECTION": {
      if (!state.history) return state;
      const len = state.history.sessions.length;
      if (!len) return state;
      const idx = (state.history.index + action.delta + len) % len;
      return { ...state, history: { ...state.history, index: idx } };
    }

    case "SET_SKILLS_VIEW":
      return { ...state, view: "skills", skills: { list: action.list, index: 0 } };

    case "MOVE_SKILLS_SELECTION": {
      if (!state.skills) return state;
      const len = state.skills.list.length;
      if (!len) return state;
      const idx = (state.skills.index + action.delta + len) % len;
      return { ...state, skills: { ...state.skills, index: idx } };
    }

    case "TOGGLE_SKILL_LOCAL": {
      if (!state.skills) return state;
      const list = state.skills.list.map((s, i) =>
        i === state.skills.index ? { ...s, enabled: !s.enabled } : s
      );
      return { ...state, skills: { ...state.skills, list } };
    }

    case "SET_WIZARD_VIEW":
      return { ...state, view: "wizard", wizard: action.wizard };

    case "UPDATE_WIZARD":
      return { ...state, wizard: { ...state.wizard, ...action.patch } };

    case "SET_GATEWAY_STATUS_VIEW":
      return { ...state, view: "gatewayStatus", gatewayStatus: action.status };

    case "SET_TASKS_VIEW":
      return { ...state, view: "tasks", tasks: { list: action.list } };

    case "SET_NOTICE":
      return { ...state, notice: action.message };

    case "SET_ERROR":
      return { ...state, error: action.message };

    case "CLEAR_TRANSIENT":
      return { ...state, error: null, notice: null };

    case "SCROLL":
      return { ...state, scrollOffset: Math.max(0, state.scrollOffset + action.delta) };

    case "SCROLL_RESET":
      return { ...state, scrollOffset: 0 };

    case "QUIT":
      return { ...state, quit: true };

    default:
      return state;
  }
}
