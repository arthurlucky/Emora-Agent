/**
 * core/pluginHooks.js
 *
 * Eksekusi `hooks/hooks.json` milik plugin — mekanisme yang dipakai
 * ekosistem Claude Code/Codex/Hermes dkk buat "selalu-aktif setiap turn"
 * (bukan cuma command yang dipanggil manual). Sebelumnya EMORA cuma
 * parse-validasi hooks.json tanpa PERNAH menjalankannya — itu sebabnya
 * plugin yang perilakunya bergantung ke hook (mis. ponytail: mode yang
 * disuntik ke context di SETIAP prompt lewat UserPromptSubmit, bukan cuma
 * saat command-nya dipanggil) kelihatan "commandnya ada tapi gak ngefek".
 *
 * Format yang didukung — SAMA PERSIS kontrak Claude Code (supaya hook
 * yang ditulis untuk Claude Code jalan apa adanya tanpa modifikasi):
 *
 *   hooks/hooks.json:
 *   {
 *     "hooks": {
 *       "SessionStart": [{ "matcher": "...", "hooks": [{ "type": "command",
 *         "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/x.js\"",
 *         "commandWindows": "...", "timeout": 5, "statusMessage": "..." }] }],
 *       "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "..." }] }]
 *     }
 *   }
 *
 *   STDIN yang dikirim ke command (JSON, 1 baris) — subset field kontrak
 *   Claude Code yang relevan: { hook_event_name, session_id, cwd, prompt }.
 *
 *   STDOUT yang dibaca dari command — terima SEMUA bentuk yang dipakai
 *   ekosistem nyata (biar hook yang sama persis, ditulis buat host lain,
 *   tetap jalan di EMORA tanpa diubah):
 *     - JSON `{ hookSpecificOutput: { additionalContext: "..." } }`
 *     - JSON `{ additionalContext: "..." }`
 *     - Teks polos (bukan JSON) -> dipakai apa adanya sebagai additionalContext
 *       (ini yang dipakai SessionStart di banyak plugin nyata).
 *
 * KEAMANAN — hook = command shell ARBITRARY yang jalan otomatis setiap
 * sesi/setiap prompt. Persis seperti Claude Code (yang mewajibkan user
 * review & approve hooks sebelum aktif), EMORA TIDAK PERNAH menjalankan
 * hook plugin manapun sampai user secara eksplisit "trust" plugin itu
 * (lihat cli/cmd-plugin.js: prompt konfirmasi otomatis muncul saat
 * install kalau plugin punya hooks/hooks.json, atau jalankan manual
 * `emora plugin trust-hooks <id>` / `untrust-hooks <id>`). Status trust
 * disimpan di plugins/.trusted-hooks.json — bukan di plugin.json plugin
 * itu sendiri, supaya plugin gak bisa "self-trust".
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";

const ROOT = process.cwd();
const PLUGINS_DIR = path.join(ROOT, "plugins");
const TRUST_FILE = path.join(PLUGINS_DIR, ".trusted-hooks.json");

const HOOK_TIMEOUT_MAX_SEC = 30; // hard cap, gak peduli berapa pun yg diminta hooks.json
const HOOK_TIMEOUT_DEFAULT_SEC = 10;

// SessionStart cuma perlu jalan sekali per sesi (mirip semantik Claude
// Code: startup/resume/clear/compact) — di-approximate sbg "sekali per
// sessionId per lifetime proses EMORA ini".
const sessionStartRanFor = new Set();

// ── Trust store ──────────────────────────────────────────────────────────

function readTrustStore() {
  try {
    return JSON.parse(fs.readFileSync(TRUST_FILE, "utf8"));
  } catch {
    return { trusted: [] };
  }
}

function writeTrustStore(store) {
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  fs.writeFileSync(TRUST_FILE, JSON.stringify(store, null, 2));
}

export function isHooksTrusted(pluginId) {
  return readTrustStore().trusted.includes(pluginId);
}

export function trustHooks(pluginId) {
  const store = readTrustStore();
  if (!store.trusted.includes(pluginId)) store.trusted.push(pluginId);
  writeTrustStore(store);
}

export function untrustHooks(pluginId) {
  const store = readTrustStore();
  store.trusted = store.trusted.filter((id) => id !== pluginId);
  writeTrustStore(store);
}

export function listTrustedHooks() {
  return readTrustStore().trusted;
}

// ── Manifest reading ─────────────────────────────────────────────────────

/**
 * Sama seperti resolveHooksPath di core/pluginManager.js (sengaja
 * dipisah/di-duplikasi, bukan di-import — modul ini murni baca dari disk
 * tiap turn, gak mau ikut ke-couple ke pluginManager yang punya state
 * in-memory sendiri). Claude Code TIDAK selalu pakai path konvensi
 * `hooks/hooks.json` — manifest (`.claude-plugin/plugin.json` atau
 * `plugin.json`) boleh punya field `"hooks"` (string path relatif) yang
 * menunjuk ke file lain. Ini BUKAN kasus langka: plugin nyata seperti
 * ponytail justru SELALU pakai pointer ini (nama filenya
 * `hooks/claude-codex-hooks.json`, bukan `hooks/hooks.json`).
 */
function resolveHooksPath(pluginId) {
  const pluginDir = path.join(PLUGINS_DIR, pluginId);
  const manifestPaths = [
    path.join(pluginDir, ".claude-plugin", "plugin.json"),
    path.join(pluginDir, "plugin.json"),
  ];
  for (const mp of manifestPaths) {
    if (!fs.existsSync(mp)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(mp, "utf8"));
      if (typeof manifest.hooks === "string" && manifest.hooks.trim()) {
        return path.join(pluginDir, manifest.hooks.trim());
      }
    } catch { /* manifest rusak -> coba fallback path konvensi di bawah */ }
    break; // manifest ketemu (walau gak ada field "hooks") -> jangan lanjut cek manifest lain
  }
  return path.join(pluginDir, "hooks", "hooks.json"); // fallback konvensi default
}

function readHooksJson(pluginId) {
  const p = resolveHooksPath(pluginId);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    return parsed.hooks || parsed; // beberapa plugin bungkus di {"hooks": {...}}, sebagian langsung {"SessionStart": [...]}
  } catch {
    return null;
  }
}

/** Daftar id plugin yang PUNYA hooks config (trusted atau belum — buat listing/prompt). */
export function listPluginsWithHooks() {
  let dirs;
  try { dirs = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true }); } catch { return []; }
  return dirs
    .filter((d) => d.isDirectory() && fs.existsSync(resolveHooksPath(d.name)))
    .map((d) => d.name);
}

// ── Variable substitution & command execution ───────────────────────────

function substituteVars(cmd, pluginDir) {
  return (cmd || "")
    .replaceAll("${CLAUDE_PLUGIN_ROOT}", pluginDir)
    .replaceAll("${PLUGIN_ROOT}", pluginDir)
    .replaceAll("%CLAUDE_PLUGIN_ROOT%", pluginDir)
    .replaceAll("%PLUGIN_ROOT%", pluginDir);
}

function runOneHookCommand({ pluginId, pluginDir, hookDef, stdinPayload }) {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const rawCmd = (isWin && hookDef.commandWindows) ? hookDef.commandWindows : hookDef.command;
    if (!rawCmd || hookDef.type !== "command") return resolve(null);

    const cmd = substituteVars(rawCmd, pluginDir);
    const timeoutMs = Math.min(Number(hookDef.timeout) || HOOK_TIMEOUT_DEFAULT_SEC, HOOK_TIMEOUT_MAX_SEC) * 1000;
    const shell = isWin ? "cmd.exe" : "/bin/sh";
    const shellFlag = isWin ? "/c" : "-c";

    const child = execFile(shell, [shellFlag, cmd], { cwd: pluginDir, timeout: timeoutMs, env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginDir, PLUGIN_ROOT: pluginDir } }, (err, stdout) => {
      if (err) {
        console.error(`[pluginHooks] hook "${pluginId}" gagal/timeout: ${err.message}`);
        return resolve(null);
      }
      resolve(stdout);
    });
    try {
      child.stdin?.write(JSON.stringify(stdinPayload));
      child.stdin?.end();
    } catch { /* command mungkin gak baca stdin sama sekali, gak masalah */ }
  });
}

/** Ekstrak additionalContext dari stdout hook, terima JSON (2 bentuk) atau teks polos. */
function extractAdditionalContext(stdout) {
  const trimmed = (stdout || "").trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed?.hookSpecificOutput?.additionalContext === "string") return parsed.hookSpecificOutput.additionalContext;
    if (typeof parsed?.additionalContext === "string") return parsed.additionalContext;
    if (typeof parsed?.systemMessage === "string") return parsed.systemMessage;
    return ""; // JSON valid tapi gak ada field yang dikenal -> gak ada context utk disuntik
  } catch {
    return trimmed; // bukan JSON -> perlakukan sbg teks context langsung (mis. SessionStart ponytail-activate.js)
  }
}

/**
 * Jalankan semua hook plugin TRUSTED untuk 1 event tertentu, gabungkan
 * hasilnya jadi 1 blok teks siap disisipkan ke system prompt. Dipanggil
 * dari core/chat.js `ask()` di setiap turn.
 */
async function runHooksForEvent(eventName, { sessionId, prompt, cwd }) {
  const trusted = listTrustedHooks();
  if (!trusted.length) return "";

  const parts = [];
  for (const pluginId of trusted) {
    const hooksConfig = readHooksJson(pluginId);
    const eventEntries = hooksConfig?.[eventName];
    if (!Array.isArray(eventEntries) || !eventEntries.length) continue;

    const pluginDir = path.join(PLUGINS_DIR, pluginId);
    const stdinPayload = { hook_event_name: eventName, session_id: sessionId, cwd: cwd || pluginDir, prompt: prompt || "" };

    for (const entry of eventEntries) {
      for (const hookDef of entry.hooks || []) {
        const stdout = await runOneHookCommand({ pluginId, pluginDir, hookDef, stdinPayload });
        if (stdout == null) continue;
        const ctx = extractAdditionalContext(stdout);
        if (ctx) parts.push(`[plugin:${pluginId}] ${ctx}`);
      }
    }
  }
  return parts.join("\n");
}

/**
 * Titik masuk dipanggil dari core/chat.js. Menjalankan SessionStart (cuma
 * sekali per sessionId per lifetime proses ini) + UserPromptSubmit (tiap
 * turn) untuk SEMUA plugin trusted, kembalikan gabungan additionalContext
 * (string kosong kalau gak ada apa-apa / gak ada plugin trusted — jalur
 * cepat, gak nyentuh fs sama sekali kalau trust list kosong).
 */
export async function getHookContextForTurn({ sessionId, prompt, cwd }) {
  const trusted = listTrustedHooks();
  if (!trusted.length) return "";

  const results = [];
  if (!sessionStartRanFor.has(sessionId)) {
    sessionStartRanFor.add(sessionId);
    const startCtx = await runHooksForEvent("SessionStart", { sessionId, prompt, cwd });
    if (startCtx) results.push(startCtx);
  }
  const promptCtx = await runHooksForEvent("UserPromptSubmit", { sessionId, prompt, cwd });
  if (promptCtx) results.push(promptCtx);

  return results.join("\n");
}

export default { isHooksTrusted, trustHooks, untrustHooks, listTrustedHooks, listPluginsWithHooks, getHookContextForTurn, getHooksPath: resolveHooksPath };
