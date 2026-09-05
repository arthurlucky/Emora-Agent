/**
 * tui/keys.js
 *
 * Satu titik masuk buat semua raw keypress dari Ink's useInput(). Routing-nya
 * berdasar status/view saat ini — approval prompt & tiap alternate view
 * (history/skills/wizard/dst) punya keybinding sendiri-sendiri.
 */
import { AVAILABLE_COMMANDS, runSlashCommand, getSkillSuggestionCache, refreshSkillSuggestionCache } from "./cmd.js";
import { deleteSession, renameSession } from "../core/sessionStore.js";
import { toggleSkill } from "./skills.js";
import { loadSession } from "../core/memory.js";
import {
  providerChoices, needsApiKey, needsUrl, buildStepSequence,
  modelChoicesFor, keyUrlFor, applyWizardResult,
} from "./wizard.js";
import { createLLM, getProviderMeta } from "../provider/index.js";

import { WORKSPACE_DIR } from "../utils/workspace.js";

let cachedFileNames = [];
async function refreshFileCache() {
  try {
    const fs = await import("fs/promises");
    const files = await fs.readdir(WORKSPACE_DIR, { withFileTypes: true });
    cachedFileNames = files
      .filter((f) => !f.name.startsWith(".") && f.name !== "node_modules")
      .map((f) => `@${f.name}`);
  } catch {}
}
refreshFileCache();

function updateSuggestions(dispatch, value) {
  if (value.includes("@")) {
    const lastWord = value.split(/\s+/).pop() || "";
    if (lastWord.startsWith("@")) {
      const matches = cachedFileNames.filter((f) => f.toLowerCase().startsWith(lastWord.toLowerCase()));
      dispatch({ type: matches.length ? "SET_SUGGESTIONS" : "CLEAR_SUGGESTIONS", suggestions: matches.length ? matches : undefined });
      return;
    }
  }

  if (!value.startsWith("/") || value.includes(" ")) {
    dispatch({ type: "CLEAR_SUGGESTIONS" });
    return;
  }
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
// Ctrl+C DITANGANI GLOBAL di handleKey() di bawah (lihat handleCtrlC) —
// supaya jalan konsisten di semua view/status, termasuk pas approval prompt.
async function handleChatKeys({ state, dispatch, controller, input, key }) {
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

  if (key.pageUp || key.pageDown || key.upArrow || key.downArrow) {
    const s = state.scrollSensitivity || "medium";
    const arrowDelta = s === "low" ? 1 : s === "medium" ? 3 : 10;
    const pageDelta = s === "low" ? 5 : s === "medium" ? 10 : 20;
    
    if (key.pageUp) return dispatch({ type: "SCROLL", delta: pageDelta });
    if (key.pageDown) return dispatch({ type: "SCROLL", delta: -pageDelta });
    if (key.upArrow) return dispatch({ type: "SCROLL", delta: arrowDelta });
    if (key.downArrow) return dispatch({ type: "SCROLL", delta: -arrowDelta });
  }

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
  let finalInput = text;
  if (state.pasteAttachments?.length) {
    for (const p of state.pasteAttachments) {
      finalInput = finalInput.replace(p.marker, p.text);
    }
  }

  const trimmed = finalInput.trim();
  if (!trimmed) return;

  if (trimmed.startsWith("/")) {
    const result = await runSlashCommand(trimmed, { state, dispatch });
    if (result) {
      dispatch({ type: "SET_INPUT", value: "" });
      if (result.type === "notice") dispatch({ type: "SET_NOTICE", message: result.message });
      if (result.type === "resume_menu") dispatch({ type: "SET_NOTICE", message: result.message, big: true });
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
function handleApprovalKeys({ state, dispatch, controller, input, key }) {
  if (key.upArrow) return dispatch({ type: "APPROVAL_MOVE", delta: -1 });
  if (key.downArrow) return dispatch({ type: "APPROVAL_MOVE", delta: 1 });
  
  const c = (input || "").toLowerCase();
  if (key.return) {
    const idx = state.approval.selectedIndex || 0;
    if (idx === 0) controller.resolveApproval(true);
    else if (idx === 1) controller.resolveApproval("always");
    else controller.resolveApproval(false);
    return;
  }
  
  // Shortcut numpad/char tetap berfungsi sbg fallback
  if (c === "1" || c === "y") controller.resolveApproval(true);
  else if (c === "2" || c === "a") controller.resolveApproval("always");
  else if (c === "3" || c === "n") controller.resolveApproval(false);
}

// ── Model picker (realtime model list) ───────────────────────────────────────
function handleModelPickerKeys({ state, dispatch, key }) {
  if (key.escape) return dispatch({ type: "MODEL_PICKER_CLOSE" });
  if (key.upArrow) return dispatch({ type: "MODEL_PICKER_MOVE", delta: -1 });
  if (key.downArrow) return dispatch({ type: "MODEL_PICKER_MOVE", delta: 1 });
  if (key.return) {
    const mp = state.modelPicker;
    const chosen = mp.models[mp.index];
    if (!chosen) return;
    // Apply async — pakai handler global yang di-set oleh slashCommands.
    dispatch({ type: "MODEL_PICKER_CLOSE" });
    globalThis.__EMORA_MODEL_APPLY__?.(mp, chosen.id);
  }
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

// ── Ctrl+C: hentikan respons, tekan lagi buat keluar ──────────────────────────
// Pola dobel-tekan ala CLI modern (Claude Code, npm, dst):
//   • Ctrl+C PERTAMA: hentikan respons AI yang lagi jalan — apapun bentuknya
//     (thinking, tool-loop, streaming, ATAU lagi nunggu approval). Kalau
//     lagi idle (gak ada yang perlu dihentikan), cuma "arm" tombol keluar.
//   • Ctrl+C KEDUA dalam EXIT_CONFIRM_MS setelah itu (state udah idle lagi)
//     → betulan keluar dari CLI.
//
// SEBELUMNYA Ctrl+C cuma ditangani di dalam handleChatKeys (chat view doang)
// dan langsung QUIT di penekanan PERTAMA kalau idle, tanpa konfirmasi. Yang
// lebih parah: approval prompt (handleApprovalKeys), history/skills/wizard/
// model-picker/dst SAMA SEKALI GAK dengarin Ctrl+C — itu sumber utama bug
// "stuck, gak bisa keluar": ask() di core/chat.js nyangkut selamanya di
// `await onApproval(...)` nunggu jawaban yang gak akan pernah datang kalau
// Ctrl+C diabaikan gitu aja. Makanya sekarang ditangani di SATU tempat, di
// paling atas handleKey(), SEBELUM routing per-view — supaya Ctrl+C selalu
// nyala di semua state/view, gak peduli lagi di layar apa.
const EXIT_CONFIRM_MS = 2000;

function isBusyStatus(status) {
  return status === "thinking"
    || status === "approval_pending"
    || status === "chain_limit_pending"
    || status === "ask_user_pending";
}

function handleCtrlC({ state, dispatch, controller }) {
  const now = Date.now();
  // exitArmedAt != null (bukan cek truthy) — Date.now() = 0 gak realistis
  // di dunia nyata (itu epoch 1970), tapi cek eksplisit lebih aman drpd
  // ngandelin coercion falsy/truthy buat angka.
  const armed = state.exitArmedAt != null && (now - state.exitArmedAt) <= EXIT_CONFIRM_MS;

  if (isBusyStatus(state.status)) {
    // controller.stop() juga otomatis nolak approval yang lagi pending
    // (lihat agentController.js) — jadi ini AMAN dipanggil dari state apa
    // pun yang dianggap "busy", termasuk approval_pending.
    controller.stop();
    dispatch({ type: "ARM_EXIT", notice: "Dihentikan. Tekan Ctrl+C sekali lagi untuk keluar." });
    return;
  }

  if (armed) {
    dispatch({ type: "QUIT" });
    return;
  }

  dispatch({ type: "ARM_EXIT", notice: "Tekan Ctrl+C sekali lagi untuk keluar dari EMORA." });
}

// ── Entry point ──────────────────────────────────────────────────────────────
export async function handleKey(ctx) {
  const { state, dispatch, controller, input, key } = ctx;

  if (key.ctrl && input === "c") {
    handleCtrlC({ state, dispatch, controller });
    return;
  }

  // ── Global Keyboard Shortcuts ──────────────────────────────────────────────
  if (key.ctrl && input === "o") {
    dispatch({ type: "TOGGLE_LOGS_VIEW" });
    return;
  }

  if (key.ctrl && input === "l") {
    dispatch({ type: "SCROLL_RESET" });
    return;
  }

  if (key.ctrl && input === "r") {
    const { listSessions } = await import("../core/sessionStore.js");
    const sessions = await listSessions();
    dispatch({ type: "SET_HISTORY_VIEW", sessions });
    return;
  }

  if (key.ctrl && input === "y") {
    const { runSlashCommand } = await import("./slashCommands.js");
    const res = await runSlashCommand("/copy", { state, dispatch });
    if (res?.message) dispatch({ type: "SET_NOTICE", message: res.message });
    return;
  }

  if (state.modelPicker) return handleModelPickerKeys(ctx);
  if (state.approval) return handleApprovalKeys(ctx);
  // Catatan: state.askUser scaffolding disiapkan buat kalau suatu saat EMORA
  // punya tool "ask_user", tapi belum ada yang men-trigger ASK_USER_REQUEST
  // saat ini (EMORA belum ada tool semacam itu) — jalur ini praktis mati.

  switch (state.view) {
    case "history": return handleHistoryKeys(ctx);
    case "artifacts": return handleArtifactsKeys(ctx);
    case "artifact_pager": return handleArtifactPagerKeys(ctx);
    case "skills": return handleSkillsKeys(ctx);
    case "scrollConfig": return handleScrollConfigKeys(ctx);
    case "wizard": return handleWizardKeys(ctx);
    case "gatewayStatus":
    case "tasks":
      return handleReadonlyKeys(ctx);
    default:
      return handleChatKeys(ctx);
  }
}

// ── Artifacts menu ───────────────────────────────────────────────────────────
async function handleArtifactsKeys({ state, dispatch, key, input }) {
  if (key.escape) return dispatch({ type: "SET_VIEW", view: "chat" });
  if (key.upArrow) return dispatch({ type: "MOVE_ARTIFACTS_SELECTION", delta: -1 });
  if (key.downArrow) return dispatch({ type: "MOVE_ARTIFACTS_SELECTION", delta: 1 });

  const sel = state.artifacts.list[state.artifacts.index];
  if (!sel) return;

  if (input === "p" || key.return) {
    const { getArtifact } = await import("../core/artifactManager.js");
    try {
      const art = getArtifact(sel.id);
      const lines = art.content.split("\n");
      dispatch({ type: "SET_ARTIFACT_PAGER_VIEW", artifact: art, lines });
    } catch (err) {
      dispatch({ type: "SET_ERROR", message: err.message });
    }
    return;
  }

  if (key.ctrl && input === "g") {
    // Export ke file sementara lalu buka di editor
    const { getArtifact } = await import("../core/artifactManager.js");
    const { resolveWorkspacePath } = await import("../utils/workspace.js");
    const fs = await import("fs");
    const cp = await import("child_process");
    
    try {
      const art = getArtifact(sel.id);
      const tmpPath = resolveWorkspacePath(`.emora_tmp_art_${sel.id}.${art.type === 'markdown' ? 'md' : 'txt'}`);
      fs.writeFileSync(tmpPath, art.content);
      
      const editor = process.env.EDITOR || "nano";
      dispatch({ type: "SET_VIEW", view: "chat" }); 
      console.clear();
      cp.execSync(`${editor} "${tmpPath}"`, { stdio: "inherit" });
      
      dispatch({ type: "SET_NOTICE", message: `Artifact ${sel.id} dibuka di ${editor}` });
    } catch (err) {
      dispatch({ type: "SET_ERROR", message: `Gagal buka editor: ${err.message}` });
    }
  }
}

// ── Artifacts Pager ──────────────────────────────────────────────────────────
async function handleArtifactPagerKeys({ state, dispatch, key, input }) {
  if (key.escape || input === "q") return dispatch({ type: "SET_VIEW", view: "artifacts" });
  
  if (key.upArrow || input === "k") return dispatch({ type: "PAGER_SCROLL", delta: -1 });
  if (key.downArrow || input === "j") return dispatch({ type: "PAGER_SCROLL", delta: 1 });
  if (key.pageUp) return dispatch({ type: "PAGER_SCROLL", delta: -20 });
  if (key.pageDown) return dispatch({ type: "PAGER_SCROLL", delta: 20 });
  if (input === "g") return dispatch({ type: "PAGER_SCROLL", delta: -999999 }); // top
  if (key.shift && input === "G") return dispatch({ type: "PAGER_SCROLL", delta: 999999 }); // bottom
  if (input === "l") return dispatch({ type: "PAGER_TOGGLE_LINES" });

  if (key.ctrl && input === "g") {
    const sel = state.artifactPager.artifact;
    const { resolveWorkspacePath } = await import("../utils/workspace.js");
    const fs = await import("fs");
    const cp = await import("child_process");
    
    try {
      const tmpPath = resolveWorkspacePath(`.emora_tmp_art_${sel.id}.${sel.type === 'markdown' ? 'md' : 'txt'}`);
      fs.writeFileSync(tmpPath, sel.content);
      
      const editor = process.env.EDITOR || "nano";
      dispatch({ type: "SET_VIEW", view: "chat" }); 
      console.clear();
      cp.execSync(`${editor} "${tmpPath}"`, { stdio: "inherit" });
      
      dispatch({ type: "SET_NOTICE", message: `Artifact ${sel.id} dibuka di ${editor}` });
    } catch (err) {
      dispatch({ type: "SET_ERROR", message: `Gagal buka editor: ${err.message}` });
    }
  }
}

// ── Scroll Config ────────────────────────────────────────────────────────────
function handleScrollConfigKeys({ state, dispatch, key, input }) {
  if (key.escape || key.return || input === "q") return dispatch({ type: "SET_VIEW", view: "chat" });
  const levels = ["low", "medium", "high"];
  const curr = levels.indexOf(state.scrollSensitivity || "medium");
  
  if (key.leftArrow) {
    const next = Math.max(0, curr - 1);
    dispatch({ type: "SET_SCROLL_SENSITIVITY", level: levels[next] });
  }
  if (key.rightArrow) {
    const next = Math.min(2, curr + 1);
    dispatch({ type: "SET_SCROLL_SENSITIVITY", level: levels[next] });
  }
}
