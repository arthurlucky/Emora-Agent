/**
 * core/pluginManager.js
 *
 * Sistem Plugin EMORA — DISTANDARKAN mengikuti layout plugin yang dipakai
 * ekosistem AI-agent CLI lain (Claude Code, Hermes Agent, Codex, dkk),
 * supaya plugin dari luar (mis. dari GitHub) bisa langsung dipasang tanpa
 * perlu ditulis ulang khusus untuk EMORA. Satu folder plugin (`./plugins/<id>/`)
 * boleh menyediakan SATU ATAU LEBIH dari kapabilitas berikut:
 *
 *   1. TOOLS (legacy EMORA-native)   — manifest.entry (default "index.js")
 *      meng-export array tool LangChain (DynamicStructuredTool).
 *   2. SKILLS                        — folder `skills/<nama>/SKILL.md`
 *      (atau `skill.md`, case-insensitive). Sama persis konsepnya dengan
 *      skill bawaan EMORA di `./skill/`: panduan/workflow, bukan kode.
 *      Otomatis masuk katalog [AVAILABLE SKILLS] DAN bisa dipanggil manual
 *      lewat `/<nama>` (lihat core/skillRegistry.js).
 *   3. COMMANDS                      — folder `commands/<nama>.md`, satu
 *      file = satu slash command manual (`/<nama>`), isinya prompt
 *      template (boleh pakai placeholder `$ARGUMENTS`).
 *   4. HOOKS                         — `hooks/hooks.json` (SessionStart +
 *      UserPromptSubmit, kontrak sama persis dgn Claude Code — lihat
 *      core/pluginHooks.js). TIDAK auto-jalan begitu install: hook =
 *      command shell arbitrary, jadi butuh "trust" eksplisit dari user
 *      (prompt otomatis muncul saat install, atau `emora plugin
 *      trust-hooks <id>`) sebelum benar-benar dieksekusi.
 *   5. MCP SERVERS                   — `.mcp.json` (map `mcpServers`),
 *      di-merge otomatis ke daftar MCP server yang dimuat EMORA saat
 *      startup (lihat tools/mcp_bridge.js `registerPendingMcpServers`).
 *
 * Manifest dicari di DUA lokasi (urutan prioritas):
 *   - `.claude-plugin/plugin.json`   (standar Claude Code — PREFERRED)
 *   - `plugin.json` di root plugin   (legacy EMORA, tetap didukung)
 *
 * Plugin HANYA dianggap gagal-install kalau TIDAK PUNYA SATU PUN dari
 * kelima kapabilitas di atas — bukan lagi mengharuskan "index.js" ada
 * begitu saja (itu bug lama: plugin skill-only/command-only seperti yang
 * dipakai Claude Code/Hermes Agent dulu selalu ditolak install).
 *
 * LIVE TOGGLE & RELOAD (tools) — tidak berubah dari versi sebelumnya:
 * LLM di-bind ke daftar tool SEKALI saat startup, jadi skema tool yang LLM
 * "tahu" tetap sejak awal. `core/tools.js` membungkus tiap tool dengan satu
 * lapis indirection: saat tool BENAR-BENAR dipanggil, baru dicek status
 * enabled/disabled DAN implementasi diambil dari referensi live-swappable
 * (`getLiveImpl`/`registerLiveImpl`). Skill & command TIDAK butuh mekanisme
 * ini karena bukan tool LLM — dibaca langsung dari disk tiap kali diresolve
 * (lihat core/skillRegistry.js), jadi otomatis "live" juga.
 */

import fs from "fs";
import path from "path";
import { registerPendingMcpServers } from "../tools/mcp_bridge.js";

const ROOT = process.cwd();
const PLUGINS_DIR = path.join(ROOT, "plugins");
const STATE_PATH = path.join(PLUGINS_DIR, "plugins_state.json");

if (!fs.existsSync(PLUGINS_DIR)) fs.mkdirSync(PLUGINS_DIR, { recursive: true });

// ── State persisten (enabled/disabled), dibaca FRESH dari disk setiap kali
// dicek — supaya toggle yang dilakukan dari proses CLI terpisah (mis.
// `emora plugin disable shell_exec` dijalankan saat gateway daemon sedang
// jalan di proses lain) langsung kelihatan oleh gateway tanpa perlu IPC.
let stateCache = null;
let stateCacheMtime = 0;

function loadState() {
  try {
    const stat = fs.statSync(STATE_PATH);
    if (stateCache && stat.mtimeMs === stateCacheMtime) return stateCache;
    stateCache = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    stateCacheMtime = stat.mtimeMs;
    return stateCache;
  } catch {
    stateCache = {};
    return stateCache;
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
  stateCache = state;
  try { stateCacheMtime = fs.statSync(STATE_PATH).mtimeMs; } catch { /* noop */ }
}

/**
 * Apakah tool/plugin dengan `name` sedang aktif? Default TRUE kalau belum
 * pernah di-set statusnya (supaya tool built-in tetap jalan out-of-the-box).
 */
export function isEnabled(name) {
  const state = loadState();
  return state[name] !== "disabled";
}

export function disable(name) {
  const state = loadState();
  state[name] = "disabled";
  saveState(state);
}

export function enable(name) {
  const state = loadState();
  state[name] = "enabled";
  saveState(state);
}

// ── Registry live implementation — dipakai wrapper di core/tools.js ────────
const liveImpls = new Map();   // toolName -> current func
const toolMeta = new Map();    // toolName -> { description, source: "builtin"|pluginId }

export function registerLiveImpl(name, func, meta = {}) {
  liveImpls.set(name, func);
  toolMeta.set(name, { description: meta.description || "", source: meta.source || "builtin" });
}

export function getLiveImpl(name) {
  return liveImpls.get(name);
}

/**
 * Daftar semua tool yang dikenal (built-in + plugin) beserta status hidup/mati.
 * Dipakai `emora plugin list` dan chat command `/plugin`.
 */
export function listAll() {
  const state = loadState();
  const out = [];
  for (const [name, meta] of toolMeta.entries()) {
    out.push({ name, description: meta.description, source: meta.source, enabled: state[name] !== "disabled" });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Plugin loading (folder ./plugins/<id>/plugin.json + entry) ─────────────

const loadedPlugins = new Map(); // id -> { manifest, tools: [], skillCount, commandCount, mcpServerCount }

/**
 * Cari & baca manifest plugin. Coba format standar (`.claude-plugin/
 * plugin.json`) dulu, baru fallback ke legacy (`plugin.json` di root).
 * Return null kalau dua-duanya gak ada — plugin skill/command-only TETAP
 * valid tanpa manifest sama sekali (id-nya diambil dari nama folder),
 * makanya null di sini bukan berarti gagal install (lihat detectCapabilities).
 */
function readManifest(pluginDir) {
  const standardPath = path.join(pluginDir, ".claude-plugin", "plugin.json");
  if (fs.existsSync(standardPath)) {
    try { return { ...JSON.parse(fs.readFileSync(standardPath, "utf8")), _manifestFormat: "claude-plugin" }; }
    catch (err) { throw new Error(`.claude-plugin/plugin.json di "${pluginDir}" rusak (invalid JSON): ${err.message}`); }
  }
  const legacyPath = path.join(pluginDir, "plugin.json");
  if (fs.existsSync(legacyPath)) {
    try { return { ...JSON.parse(fs.readFileSync(legacyPath, "utf8")), _manifestFormat: "legacy" }; }
    catch (err) { throw new Error(`plugin.json di "${pluginDir}" rusak (invalid JSON): ${err.message}`); }
  }
  // Fallback ketiga (dipetik dari cara kerja pluginManager Elynisia): repo
  // yang gak punya plugin.json/​.claude-plugin SAMA SEKALI tapi punya
  // package.json (umum buat plugin yang aslinya paket npm/MCP server
  // biasa) — turunkan manifest minimal dari situ, daripada dianggap gak
  // punya manifest sama sekali.
  const pkgPath = path.join(pluginDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      return {
        id: pkg.name?.replace(/^@/, "").replace("/", "_"),
        name: pkg.displayName || pkg.name,
        version: pkg.version || "1.0.0",
        description: pkg.description || "",
        author: typeof pkg.author === "string" ? pkg.author : pkg.author?.name || "",
        entry: pkg.main || "index.js",
        _manifestFormat: "package.json",
      };
    } catch { /* package.json rusak -> anggap gak ada manifest, lanjut ke capability-scan folder biasa */ }
  }
  return null;
}

/** Deteksi kapabilitas apa saja yang disediakan folder plugin ini. */
/**
 * Resolve path file hooks config yang SEBENARNYA dipakai plugin ini.
 * Claude Code TIDAK selalu pakai path konvensi `hooks/hooks.json` — manifest
 * (`.claude-plugin/plugin.json`) boleh punya field `"hooks"` (string path
 * relatif) yang menunjuk ke file lain, dan banyak plugin nyata MEMANG pakai
 * ini (mis. ponytail menamai file-nya `hooks/claude-codex-hooks.json` justru
 * supaya TIDAK kena validasi ketat marketplace yang otomatis berlaku di path
 * default `hooks/hooks.json`). Urutan resolusi:
 *   1. `manifest.hooks` kalau berupa string -> path relatif ke pluginDir.
 *   2. Fallback konvensi default: `hooks/hooks.json`.
 */
function resolveHooksPath(pluginDir, manifest) {
  if (typeof manifest?.hooks === "string" && manifest.hooks.trim()) {
    return path.join(pluginDir, manifest.hooks.trim());
  }
  return path.join(pluginDir, "hooks", "hooks.json");
}

function detectCapabilities(pluginDir, manifest) {
  const entryFile = manifest?.entry || "index.js";
  const hasEntry = fs.existsSync(path.join(pluginDir, entryFile));
  const hasSkills = fs.existsSync(path.join(pluginDir, "skills"));
  const hasCommands = fs.existsSync(path.join(pluginDir, "commands"));
  const hooksPath = resolveHooksPath(pluginDir, manifest);
  const hasHooks = fs.existsSync(hooksPath);
  const mcpJsonPath = path.join(pluginDir, ".mcp.json");
  const hasMcpFile = fs.existsSync(mcpJsonPath);
  const hasMcpInManifest = !!(manifest?.mcpServers && Object.keys(manifest.mcpServers).length);
  return { hasEntry, hasSkills, hasCommands, hasHooks, hooksPath, hasMcpFile, hasMcpInManifest, mcpJsonPath, entryFile };
}

/**
 * Muat 1 plugin dari folder `./plugins/<id>/`. Berbeda dari versi lama:
 * TIDAK mengharuskan entry file ada — plugin boleh hanya berisi skills/,
 * commands/, hooks/, dan/atau .mcp.json (format standar Claude Code/Hermes
 * Agent dkk). Entry file JS (tool LangChain) tetap didukung penuh kalau ada.
 */
export async function loadPlugin(id) {
  const pluginDir = path.join(PLUGINS_DIR, id);
  if (!fs.existsSync(pluginDir)) throw new Error(`Plugin "${id}" tidak ditemukan di ${pluginDir}.`);

  const manifest = readManifest(pluginDir) || {};
  const caps = detectCapabilities(pluginDir, manifest);

  if (!caps.hasEntry && !caps.hasSkills && !caps.hasCommands && !caps.hasHooks && !caps.hasMcpFile && !caps.hasMcpInManifest) {
    throw new Error(
      `Plugin "${id}" tidak punya kapabilitas yang dikenali EMORA. Sediakan salah satu: ` +
      `entry file tool (manifest "entry", default index.js), folder skills/<nama>/SKILL.md, ` +
      `folder commands/<nama>.md, hooks/hooks.json, atau .mcp.json. ` +
      `(Ini kemungkinan plugin yang dibuat untuk host lain seperti Codex/Gemini CLI yang formatnya ` +
      `tidak overlap dengan lima kapabilitas di atas sama sekali.)`
    );
  }

  let pluginTools = [];
  if (caps.hasEntry) {
    const entryPath = path.join(pluginDir, caps.entryFile);
    const mod = await import(`file://${entryPath}?t=${Date.now()}`); // cache-bust
    pluginTools = mod.default || mod.tools || [];
    if (!Array.isArray(pluginTools)) {
      throw new Error(`Entry plugin "${id}" harus meng-export array tool (default export atau named export "tools").`);
    }
    for (const tool of pluginTools) {
      // Sama seperti wrapWithToggle di core/tools.js: pakai .invoke() bukan
      // .func langsung, supaya tool plugin yang dibuat pakai helper `tool()`
      // (bukan `new DynamicStructuredTool()`) tetap aman terdaftar.
      registerLiveImpl(tool.name, (input) => tool.invoke(input), { description: tool.description, source: id });
    }
  }

  // Skill & command dari plugin TIDAK perlu "dimuat" ke memori di sini —
  // core/skillRegistry.js membaca langsung dari disk (plugins/<id>/skills,
  // plugins/<id>/commands) tiap kali diresolve, jadi otomatis konsisten
  // begitu foldernya ada, tanpa state tambahan yang bisa basi.
  let skillCount = 0, commandCount = 0;
  if (caps.hasSkills) {
    try { skillCount = fs.readdirSync(path.join(pluginDir, "skills"), { withFileTypes: true }).filter((e) => e.isDirectory()).length; } catch {}
  }
  if (caps.hasCommands) {
    try { commandCount = fs.readdirSync(path.join(pluginDir, "commands")).filter((f) => /\.(md|toml)$/i.test(f)).length; } catch {}
  }

  // MCP server yang dibawa plugin (.mcp.json standar Claude Code, atau
  // field "mcpServers" langsung di manifest) didaftarkan ke antrian yang
  // dibaca tools/mcp_bridge.js saat startup (loadMCPTools), digabung
  // dengan server dari ./mcp/mcp.config.json.
  let mcpServerCount = 0;
  let mcpServersObj = manifest.mcpServers || null;
  if (caps.hasMcpFile) {
    try {
      const parsed = JSON.parse(fs.readFileSync(caps.mcpJsonPath, "utf8"));
      mcpServersObj = { ...(mcpServersObj || {}), ...(parsed.mcpServers || parsed) };
    } catch (err) {
      console.error(`[pluginManager] .mcp.json plugin "${id}" invalid: ${err.message}`);
    }
  }
  if (mcpServersObj && Object.keys(mcpServersObj).length) {
    mcpServerCount = registerPendingMcpServers(id, mcpServersObj);
  }

  if (caps.hasHooks) {
    // Validasi hooks.json di sini (fail fast kalau JSON-nya rusak). Eksekusi
    // AKTUAL hook (SessionStart/UserPromptSubmit) ditangani core/pluginHooks.js,
    // dipanggil per-turn dari core/chat.js `ask()` — dan HANYA jalan untuk
    // plugin yang sudah di-"trust" user (lihat cli/cmd-plugin.js: prompt
    // konfirmasi otomatis muncul di sini/saat install lewat caller-nya).
    try { JSON.parse(fs.readFileSync(caps.hooksPath, "utf8")); }
    catch (err) { console.error(`[pluginManager] hooks.json plugin "${id}" invalid, diabaikan: ${err.message}`); }
  }

  loadedPlugins.set(id, { manifest, tools: pluginTools, skillCount, commandCount, mcpServerCount, caps });
  return { id, manifest, toolCount: pluginTools.length, skillCount, commandCount, mcpServerCount, hasHooks: caps.hasHooks, hooksPath: caps.hooksPath, pluginDir };
}

/**
 * Install plugin baru dari folder lokal (copy ke ./plugins/<id>/), lalu load.
 * Untuk instalasi dari Git URL, gunakan flow yang sama seperti
 * `cli/cmd-community.js` (clone dulu, baru panggil `loadPlugin`).
 */
export async function installPluginFromPath(sourcePath) {
  const manifest = readManifest(sourcePath);
  // "id" di manifest opsional sekarang — kalau gak ada (umum untuk plugin
  // skill/command-only format Claude Code, yang manifestnya cuma punya
  // name/description/version), pakai nama folder sumbernya sebagai id.
  const id = manifest?.id || path.basename(path.resolve(sourcePath)).toLowerCase().replace(/[^a-z0-9_-]/g, "_");

  const targetDir = path.join(PLUGINS_DIR, id);
  fs.cpSync(sourcePath, targetDir, { recursive: true });

  const result = await loadPlugin(id);
  return result;
}

/**
 * Install plugin langsung dari Git URL (clone) — sama seperti pola
 * `installPlugin(userId, gitUrl)` di Elynisia. Kalau folder plugin dengan
 * nama repo yang sama sudah pernah di-clone sebelumnya, jalankan `git pull`
 * untuk update alih-alih clone ulang.
 */
export async function installPluginFromGit(gitUrl) {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const execFileAsync = promisify(execFile);

  const repoName = path.basename(gitUrl, ".git").toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const targetDir = path.join(PLUGINS_DIR, repoName);

  if (fs.existsSync(targetDir)) {
    await execFileAsync("git", ["-C", targetDir, "pull"]);
  } else {
    await execFileAsync("git", ["clone", gitUrl, targetDir]);
  }

  const manifest = readManifest(targetDir);
  const id = manifest?.id || repoName;

  // Kalau plugin.json memakai id yang beda dari nama folder hasil clone,
  // pindahkan foldernya supaya konsisten dengan id di manifest (loadPlugin
  // mencari folder berdasarkan id, bukan nama repo).
  if (id !== repoName) {
    const idDir = path.join(PLUGINS_DIR, id);
    if (!fs.existsSync(idDir)) fs.renameSync(targetDir, idDir);
  }

  const result = await loadPlugin(id);
  return result;
}

/**
 * Deteksi: apakah string ini kelihatan seperti Git URL (http(s)://, git@,
 * atau diakhiri .git) atau path folder lokal biasa. Dipakai CLI/chat
 * command `install` supaya user gak perlu sebut secara eksplisit sumbernya.
 */
export function looksLikeGitUrl(str) {
  return /^(https?:\/\/|git@)/.test(str) || str.endsWith(".git");
}

export async function reloadPlugin(id) {
  if (loadedPlugins.has(id)) {
    // Hapus live impl lama punya plugin ini supaya tidak ada sisa tool basi
    // kalau plugin versi baru menghapus/mengganti nama sebagian tool-nya.
    const old = loadedPlugins.get(id);
    for (const tool of old.tools) {
      if (toolMeta.get(tool.name)?.source === id) {
        liveImpls.delete(tool.name);
        toolMeta.delete(tool.name);
      }
    }
  }
  return loadPlugin(id); // re-import fresh (cache-bust otomatis lewat query param timestamp)
}

export function listPlugins() {
  return Array.from(loadedPlugins.entries()).map(([id, p]) => ({
    id,
    name: p.manifest.name || id,
    version: p.manifest.version || "1.0.0",
    description: p.manifest.description || "",
    toolCount: p.tools.length,
    skillCount: p.skillCount || 0,
    commandCount: p.commandCount || 0,
    mcpServerCount: p.mcpServerCount || 0,
    manifestFormat: p.manifest._manifestFormat || "none",
    tools: p.tools, // array tool LangChain asli (punya .name, .description, .schema)
  }));
}

/**
 * Muat semua plugin yang ada di folder ./plugins/ saat startup (dipanggil
 * dari core/tools.js). Plugin yang error saat load di-skip (tidak
 * menjatuhkan seluruh proses), errornya di-log ke console.
 */
export async function loadAllPlugins() {
  if (!fs.existsSync(PLUGINS_DIR)) return;
  const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "ponytail") {
      try { fs.rmSync(path.join(PLUGINS_DIR, entry.name), { recursive: true, force: true }); } catch {}
      continue;
    }
    try {
      await loadPlugin(entry.name);
    } catch (err) {
      console.error(`[pluginManager] Gagal memuat plugin "${entry.name}": ${err.message}`);
    }
  }
}

export async function uninstallPlugin(id) {
  const pluginDir = path.join(PLUGINS_DIR, id);
  if (fs.existsSync(pluginDir)) {
    fs.rmSync(pluginDir, { recursive: true, force: true });
    loadedPlugins.delete(id);
    return true;
  }
  return false;
}

export default {
  isEnabled, disable, enable,
  registerLiveImpl, getLiveImpl, listAll,
  loadPlugin, installPluginFromPath, installPluginFromGit, looksLikeGitUrl, reloadPlugin, listPlugins, loadAllPlugins, uninstallPlugin,
};
