/**
 * tui/keys.js
 *
 * Satu titik masuk buat semua raw keypress dari Ink's useInput(). Routing-nya
 * berdasar status/view saat ini — approval prompt & tiap alternate view
 * (history/skills/wizard/dst) punya keybinding sendiri-sendiri.
 */
import { AVAILABLE_COMMANDS, runSlashCommand, renameSession, deleteSession, getSkillSuggestionCache, refreshSkillSuggestionCache } from "./slashCommands.js";
import { toggleSkill } from "./skillsMenu.js";
import { loadSession } from "../core/memory.js";
import {
  providerChoices, needsApiKey, needsUrl, buildStepSequence,
  modelChoicesFor, keyUrlFor, applyWizardResult,
} from "./wizard.js";
import { createLLM, getProviderMeta } from "../provider/index.js";

function updateSuggestions(dispatch, value) {
  if (!value.startsWith("/") || value.includes(" ")) {
    dispatch({ type: "CLEAR_SUGGESTIONS" });
    return;
  }
  // Gabung command bawaan TUI DENGAN nama skill/command (bawaan + plugin,
  // termasuk bentuk namespaced "/plugin:nama") — dulu dropdown ini cuma
  // berisi 21 command bawaan, jadi skill/plugin sama sekali gak nongol di
  // sini walau bisa dipanggil manual. Dedup pakai Set karena nama skill
  // bawaan bisa saja tabrakan persis sama command bawaan (jarang, tapi aman).
  const combined = [...new Set([...AVAILABLE_COMMANDS, ...getSkillSuggestionCache()])];
  const matches = combined.filter((c) => c.startsWith(value));
  dispatch({ type: matches.length ? "SET_SUGGESTIONS" : "CLEAR_SUGGESTIONS", suggestions: matches.length ? matches : undefined });
}

// ── Text input editing (dipakai di banyak tempat: chat box, wizard text step) ──
// Navigasi ala nano/readline: Home/End, Ctrl+A/E (awal/akhir), Ctrl+K
// (potong ke akhir), Ctrl+U (potong semua), Ctrl+W (hapus kata sebelum
// kursor), Alt+B/F / Ctrl+Left/Right (lompat per kata).
function editBuffer(value, cursorPos, input, key) {
  if (key.backspace || key.delete) {
    // Alt+Backspace = hapus kata sebelum kursor.
    if (key.meta) {
      const newPos = wordJumpBack(value, cursorPos);
      return { value: value.slice(0, newPos) + value.slice(cursorPos), cursorPos: newPos };
    }
    if (cursorPos <= 0) return { value, cursorPos };
    return { value: value.slice(0, cursorPos - 1) + value.slice(cursorPos), cursorPos: cursorPos - 1 };
  }
  if (key.leftArrow) {
    if (key.ctrl || key.meta || key.alt) return { value, cursorPos: wordJumpBack(value, cursorPos) }; // Ctrl+Left = kata
    return { value, cursorPos: Math.max(0, cursorPos - 1) };
  }
  if (key.rightArrow) {
    if (key.ctrl || key.meta || key.alt) return { value, cursorPos: wordJumpFwd(value, cursorPos) }; // Ctrl+Right = kata
    return { value, cursorPos: Math.min(value.length, cursorPos + 1) };
  }
  if (input && !key.ctrl && !key.meta) {
    return { value: value.slice(0, cursorPos) + input + value.slice(cursorPos), cursorPos: cursorPos + input.length };
  }
  // Ctrl-chords yang datang lewat `input` char (Ink tidak selalu expose sebagai key.*).
  if (key.ctrl && input) {
    switch (input.toLowerCase()) {
      case "a": return { value, cursorPos: 0 };
      case "e": return { value, cursorPos: value.length };
      case "k": return { value: value.slice(0, cursorPos), cursorPos };           // potong ke akhir
      case "u": return { value: value.slice(cursorPos), cursorPos: 0 };           // potong ke awal
      case "w": { const p = wordJumpBack(value, cursorPos); return { value: value.slice(0, p) + value.slice(cursorPos), cursorPos: p }; }
      case "b": return { value, cursorPos: Math.max(0, cursorPos - 1) };
      case "f": return { value, cursorPos: Math.min(value.length, cursorPos + 1) };
    }
  }
  return { value, cursorPos };
}

// Lompat awal kata SEBELUM kursor (ala nano Alt+B).
function wordJumpBack(value, pos) {
  let i = pos;
  while (i > 0 && /\s/.test(value[i - 1])) i--;
  while (i > 0 && !/\s/.test(value[i - 1])) i--;
  return i;
}

// Lompat awal kata SETELAH kursor (ala nano Alt+F).
function wordJumpFwd(value, pos) {
  let i = pos;
  while (i < value.length && /\s/.test(value[i])) i++;
  while (i < value.length && !/\s/.test(value[i])) i++;
  return i;
}

// ── Chat view ────────────────────────────────────────────────────────────────
async function handleChatKeys({ state, dispatch, controller, input, key }) {
  if (key.ctrl && input === "c") {
    if (state.status === "thinking") controller.stop();
    else dispatch({ type: "QUIT" });
    return;
  }

  if (state.suggestions?.length) {
    if (key.upArrow) return dispatch({ type: "MOVE_SUGGESTION", delta: -1 });
    if (key.downArrow) return dispatch({ type: "MOVE_SUGGESTION", delta: 1 });
    if (key.tab || key.return) {
      const chosen = state.suggestions[state.suggestionIndex];
      if (key.tab) {
        dispatch({ type: "SET_INPUT", value: chosen + " " });
        dispatch({ type: "CLEAR_SUGGESTIONS" });
        return;
      }
      // Enter -> langsung jalankan command yang dipilih
      dispatch({ type: "CLEAR_SUGGESTIONS" });
      return submitText(chosen, { state, dispatch, controller });
    }
    if (key.escape) return dispatch({ type: "CLEAR_SUGGESTIONS" });
  }

  if (key.escape) {
    dispatch({ type: "CLEAR_TRANSIENT" });
    return;
  }

  if (key.pageUp) return dispatch({ type: "SCROLL", delta: 5 });
  if (key.pageDown) return dispatch({ type: "SCROLL", delta: -5 });

  if (key.return) {
    if (state.status !== "idle") return; // lagi mikir, gak bisa kirim lagi
    return submitText(state.input, { state, dispatch, controller });
  }

  const { value, cursorPos } = editBuffer(state.input, state.cursorPos, input, key);
  if (value !== state.input || cursorPos !== state.cursorPos) {
    dispatch({ type: "SET_INPUT", value, cursorPos });
    updateSuggestions(dispatch, value);
  }
}

async function submitText(text, { state, dispatch, controller }) {
  const trimmed = text.trim();
  if (!trimmed) return;

  if (trimmed.startsWith("/")) {
    const result = await runSlashCommand(trimmed, { state, dispatch });
    if (result) {
      dispatch({ type: "SET_INPUT", value: "" });
      if (result.type === "notice") dispatch({ type: "SET_NOTICE", message: result.message });
      if (result.type === "error") dispatch({ type: "SET_ERROR", message: result.message });
      // Fire-and-forget: command apa pun bisa saja mengubah daftar skill
      // (install/reload plugin, /learn skill baru, dll) — refresh cache
      // autocomplete di background daripada nebak-nebak command mana aja
      // yang perlu di-whitelist.
      refreshSkillSuggestionCache();
      return;
    }
  }

  controller.submit(trimmed);
}

// ── Approval prompt ──────────────────────────────────────────────────────────
function handleApprovalKeys({ controller, input, key }) {
  const c = (input || "").toLowerCase();
  // Dialog bernomor ala TUI.md: 1=Yes · 2=Yes selalu (turn ini) · 3/n=No.
  if (c === "1" || key.return || c === "y") controller.resolveApproval(true);
  else if (c === "2" || c === "a") controller.resolveApproval("always");
  else if (c === "3" || c === "n") controller.resolveApproval(false);
}

// ── History browser ──────────────────────────────────────────────────────────
async function handleHistoryKeys({ state, dispatch, key, input }) {
  if (key.escape) return dispatch({ type: "SET_VIEW", view: "chat" });
  if (key.upArrow) return dispatch({ type: "MOVE_HISTORY_SELECTION", delta: -1 });
  if (key.downArrow) return dispatch({ type: "MOVE_HISTORY_SELECTION", delta: 1 });

  const sessions = state.history.sessions;
  const sel = sessions[state.history.index];
  if (!sel) return;

  if (key.return) {
    const messages = await loadSession(sel.id);
    dispatch({ type: "LOAD_SESSION", sessionId: sel.id, sessionTitle: sel.title, messages });
    return;
  }
  if (input === "d") {
    await deleteSession(sel.id);
    const remaining = sessions.filter((s) => s.id !== sel.id);
    dispatch({ type: "SET_HISTORY_VIEW", sessions: remaining });
    return;
  }
}

// ── Skills menu ──────────────────────────────────────────────────────────────
async function handleSkillsKeys({ state, dispatch, key, input }) {
  if (key.escape) return dispatch({ type: "SET_VIEW", view: "chat" });
  if (key.upArrow) return dispatch({ type: "MOVE_SKILLS_SELECTION", delta: -1 });
  if (key.downArrow) return dispatch({ type: "MOVE_SKILLS_SELECTION", delta: 1 });

  if (input === " ") {
    const skill = state.skills.list[state.skills.index];
    if (!skill || skill.toggleable === false) return; // skill/command dari plugin: dikelola lewat /plugin, bukan di sini
    dispatch({ type: "TOGGLE_SKILL_LOCAL" });
    try { await toggleSkill(skill); } catch { /* biarin, UI udah keburu keliatan toggle */ }
  }
}

// ── Read-only views (gateway status / tasks) ────────────────────────────────
function handleReadonlyKeys({ dispatch, key }) {
  if (key.escape) dispatch({ type: "SET_VIEW", view: "chat" });
}

// ── Setup wizard ─────────────────────────────────────────────────────────────
async function handleWizardKeys({ state, dispatch, key, input }) {
  const w = state.wizard;
  const step = w.sequence[w.stepIndex] || "provider";

  if (key.escape) {
    if (w.stepIndex === 0) dispatch({ type: "SET_VIEW", view: "chat" });
    else dispatch({ type: "UPDATE_WIZARD", patch: { stepIndex: w.stepIndex - 1 } });
    return;
  }

  if (step === "provider" || (step === "model" && w.choices?.[w.optionIndex]?.value !== "__custom__")) {
    if (key.upArrow) return dispatch({ type: "UPDATE_WIZARD", patch: { optionIndex: Math.max(0, w.optionIndex - 1) } });
    if (key.downArrow) return dispatch({ type: "UPDATE_WIZARD", patch: { optionIndex: Math.min((w.choices?.length || 1) - 1, w.optionIndex + 1) } });
  }

  if (step === "model" && w.choices?.[w.optionIndex]?.value === "__custom__" && !key.return) {
    const { value, cursorPos } = editBuffer(w.textBuffer, w.textBuffer.length, input, key);
    return dispatch({ type: "UPDATE_WIZARD", patch: { textBuffer: value } });
  }

  if ((step === "apiKey" || step === "url") && !key.return) {
    const { value } = editBuffer(w.textBuffer, w.textBuffer.length, input, key);
    return dispatch({ type: "UPDATE_WIZARD", patch: { textBuffer: value } });
  }

  if (!key.return) return;

  // ── Enter ditekan: maju ke step berikutnya ──────────────────────────────
  if (step === "provider") {
    const provider = w.choices[w.optionIndex].value;
    const sequence = buildStepSequence(provider);
    const patch = { provider, sequence, stepIndex: 1, textBuffer: "" };
    if (sequence[1] === "apiKey") {
      patch.keyUrl = await keyUrlFor(provider);
    }
    if (sequence[1] === "model") {
      const { choices } = await modelChoicesFor(provider);
      patch.choices = choices;
      patch.optionIndex = 0;
    }
    dispatch({ type: "UPDATE_WIZARD", patch });
    return;
  }

  if (step === "apiKey") {
    const nextIndex = w.stepIndex + 1;
    const patch = { apiKey: w.textBuffer, stepIndex: nextIndex, textBuffer: "" };
    if (w.sequence[nextIndex] === "model") {
      const { choices } = await modelChoicesFor(w.provider);
      patch.choices = choices;
      patch.optionIndex = 0;
    }
    dispatch({ type: "UPDATE_WIZARD", patch });
    return;
  }

  if (step === "url") {
    const nextIndex = w.stepIndex + 1;
    const patch = { url: w.textBuffer, stepIndex: nextIndex, textBuffer: "" };
    if (w.sequence[nextIndex] === "model") {
      const { choices } = await modelChoicesFor(w.provider);
      patch.choices = choices;
      patch.optionIndex = 0;
    }
    dispatch({ type: "UPDATE_WIZARD", patch });
    return;
  }

  if (step === "model") {
    const chosen = w.choices[w.optionIndex];
    const model = chosen.value === "__custom__" ? w.textBuffer : chosen.value;
    dispatch({ type: "UPDATE_WIZARD", patch: { model, stepIndex: w.stepIndex + 1 } });
    return;
  }

  if (step === "confirm") {
    applyWizardResult(w);
    try {
      const llm = await createLLM([], w.provider, { apiKey: w.apiKey, model: w.model, url: w.url || undefined });
      const meta = getProviderMeta(w.provider);
      dispatch({ type: "SET_PROVIDER", provider: { name: meta.label, model: w.model } });
      dispatch({ type: "SET_VIEW", view: "chat" });
      // simpan LLM baru ke luar lewat window global sederhana (dibaca App.js)
      globalThis.__EMORA_TUI_LLM__ = llm;
    } catch (err) {
      dispatch({ type: "SET_ERROR", message: `Gagal pakai provider baru: ${err.message}` });
    }
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────
export async function handleKey(ctx) {
  const { state } = ctx;

  if (state.approval) return handleApprovalKeys(ctx);
  // Catatan: state.askUser scaffolding disiapkan buat kalau suatu saat EMORA
  // punya tool "ask_user", tapi belum ada yang men-trigger ASK_USER_REQUEST
  // saat ini (EMORA belum ada tool semacam itu) — jalur ini praktis mati.

  switch (state.view) {
    case "history": return handleHistoryKeys(ctx);
    case "skills": return handleSkillsKeys(ctx);
    case "wizard": return handleWizardKeys(ctx);
    case "gatewayStatus":
    case "tasks":
      return handleReadonlyKeys(ctx);
    default:
      return handleChatKeys(ctx);
  }
}
