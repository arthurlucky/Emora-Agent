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

/** Ringkas args tool jadi satu baris pendek ala Claude Code. */
export function summarizeArgs(args = {}) {
  try {
    const keys = Object.keys(args);
    if (!keys.length) return "";
    // Prioritaskan key umum: path/query/command/url/file_path
    const pref = ["path", "file_path", "rel_path", "query", "command", "url", "pattern", "topic", "action", "name"];
    const parts = [];
    for (const k of pref) {
      if (args[k] != null && parts.length < 2) {
        const v = String(args[k]);
        parts.push(`${k}: "${v.slice(0, 40)}${v.length > 40 ? "…" : ""}"`);
      }
    }
    if (!parts.length) {
      const v = JSON.stringify(args);
      return v.slice(0, 50) + (v.length > 50 ? "…" : "");
    }
    if (keys.length > parts.length) parts.push("…");
    return parts.join(", ");
  } catch { return ""; }
}

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
    modelPicker: null, // {name, providerKey, url, apiKey, compat, models[], index}

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
    // Timestamp Ctrl+C pertama saat idle (pola "tekan lagi buat keluar").
    // null = belum "armed". Lihat handleKey()/handleCtrlC() di tui/keys.js.
    exitArmedAt: null,
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
        // BUGFIX: notice (mis. dari /thinking, /mode, dst) sebelumnya cuma
        // dibersihkan oleh CLEAR_TRANSIENT (Escape) atau ganti view — kalau
        // user langsung ngirim pesan baru tanpa itu, notice LAMA numpuk di
        // footer di bawah spinner turn yang baru ("teks hasil perintah gak
        // pernah hilang"). Turn baru mulai = notice lama otomatis basi.
        notice: null,
        noticeBig: false,
        // Turn baru mulai → lupain status "armed" dari Ctrl+C idle
        // sebelumnya, supaya Ctrl+C pertama di turn ini PASTI menghentikan
        // respons, bukan malah langsung keluar gara-gara sisa arming lama.
        exitArmedAt: null,
        scrollOffset: 0,
      };
    }

    case "AGENT_TOOL_USE": {
      // Claude Code style: ● Tool(args) — args diringkas.
      const argsStr = summarizeArgs(action.args);
      const line = C.yellow("● ") + C.bold(action.name) + C.dim(`(${argsStr})`);
      const entry = { line, name: action.name, args: action.args || {}, result: null };
      return { ...state, progressLines: [...state.progressLines.slice(-30), entry] };
    }

    case "AGENT_TOOL_RESULT": {
      // Tempel hasil ke entri tool terakhir yang cocok nama-nya.
      const lines = [...state.progressLines];
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i]?.name === action.name && !lines[i].result) {
          lines[i] = { ...lines[i], result: action };
          break;
        }
      }
      return { ...state, progressLines: lines };
    }

    case "AGENT_TOOL_DENIED": {
      return { ...state, progressLines: [...state.progressLines.slice(-30), C.red("✘ " + action.name + " ditolak")] };
    }

    case "AGENT_SKILL_READ": {
      return { ...state, progressLines: [...state.progressLines.slice(-30), C.yellow("◈ skill: " + action.name)] };
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
      // Kalau abort ini abis dari Ctrl+C (exitArmedAt barusan di-set lewat
      // ARM_EXIT di handleCtrlC — satu-satunya jalur yang bisa memicu abort
      // di TUI ini), pertahankan hint "tekan lagi buat keluar" biar gak
      // ke-timpa notice polos begitu status balik ke idle.
      const notice = state.exitArmedAt != null
        ? "Dihentikan. Tekan Ctrl+C sekali lagi untuk keluar."
        : "Dihentikan.";
      return { ...state, status: "idle", progressLines: [], abortController: null, notice };
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

    case "LOAD_SESSION": {
      // Aturan TUI.md #10: resume → panel "Previous Conversation" berisi
      // ringkasan percakapan lama, digabung ke atas transcript.
      const prev = (action.messages || []).slice(-6).map((m) => {
        const who = m.role === "user" ? "You" : "Hermes";
        const body = String(m.content || "").split("\n")[0].slice(0, 120);
        return { role: m.role, line: `  ● ${who}: ${body}` };
      });
      return {
        ...state,
        sessionId: action.sessionId,
        sessionTitle: action.sessionTitle,
        messages: action.messages,
        view: "chat",
        notice: `↻ Resumed session ${action.sessionId} "${action.sessionTitle}" (${action.messages.length} messages)`,
        previousConversation: prev.length ? prev : null,
      };
    }

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
      return { ...state, notice: action.message, noticeBig: !!action.big };

    case "MODEL_PICKER":
      // Aturan user: pilih provider tersimpan → milih ulang model REALTIME.
      return { ...state, modelPicker: { ...action.payload } };

    case "MODEL_PICKER_MOVE":
      return {
        ...state,
        modelPicker: { ...state.modelPicker, index: Math.max(0, Math.min(state.modelPicker.models.length - 1, state.modelPicker.index + action.delta)) },
      };

    case "MODEL_PICKER_CLOSE":
      return { ...state, modelPicker: null };

    case "SET_ERROR":
      return { ...state, error: action.message };

    case "CLEAR_TRANSIENT":
      return { ...state, error: null, notice: null, exitArmedAt: null };

    case "ARM_EXIT":
      // Ctrl+C pertama (saat idle) atau abis nyetop respons: "arm" tombol
      // keluar + kasih notice, tapi belum betulan keluar. Ctrl+C KEDUA
      // dalam jendela waktu tertentu (EXIT_CONFIRM_MS di keys.js) baru
      // dispatch QUIT. Lihat handleCtrlC() di tui/keys.js.
      return { ...state, exitArmedAt: Date.now(), notice: action.notice, noticeBig: false };

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
