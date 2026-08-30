/**
 * core/skillRegistry.js
 *
 * Registry TERPADU untuk "hal yang bisa dijalankan by name": Skill bawaan
 * EMORA (./skill/<nama>/skill.md), Skill yang datang dari plugin
 * (./plugins/<id>/skills/<nama>/SKILL.md — format standar yang dipakai
 * Claude Code / Hermes Agent dkk), DAN Command yang datang dari plugin
 * (./plugins/<id>/commands/<nama>.md — juga format standar Claude Code:
 * satu file markdown = satu slash command, isinya prompt template yang
 * boleh mengandung placeholder `$ARGUMENTS`).
 *
 * Kenapa disatukan di sini (bukan cuma dibaca tersebar di beberapa
 * tempat seperti sebelumnya):
 *   1. Supaya katalog [AVAILABLE SKILLS] di system prompt (core/chat.js)
 *      otomatis mencakup skill DARI PLUGIN juga, bukan cuma built-in.
 *   2. Supaya SEMUA skill/command — built-in ATAU plugin — bisa dipanggil
 *      manual lewat `/<nama>` di TUI maupun tiap gateway (Telegram,
 *      WhatsApp, Discord, Slack, Matrix), lewat satu titik resolve() yang
 *      sama (dipakai dari core/chat.js `ask()`), DAN langsung tersedia
 *      seketika habis plugin diinstall — TANPA restart, karena dibaca
 *      langsung dari disk tiap kali diresolve (bukan di-cache di memori).
 *
 * PENAMAAN COMMAND/SKILL DARI PLUGIN — NAMESPACED, sama seperti Claude
 * Code/Antigravity CLI/OpenClaw:
 *   `/<plugin_id>:<nama>`   — bentuk KANONIK, SELALU tersedia begitu
 *                             plugin ke-install, gak akan pernah tabrakan
 *                             sama plugin lain atau skill bawaan.
 *   `/<nama>` (tanpa namespace) — shorthand yang JUGA jalan SELAMA nama
 *                             itu unik di seluruh plugin yang terpasang.
 *                             Kalau ada 2+ plugin yang punya command/skill
 *                             nama sama, shorthand ini akan dianggap
 *                             ambigu (lihat resolveCandidates) dan user
 *                             diminta pakai bentuk `plugin:nama` biar jelas.
 * Skill BAWAAN (bukan dari plugin) TIDAK pakai namespace — `/<nama>` saja,
 * karena sumbernya cuma satu (folder ./skill/) jadi gak mungkin tabrakan.
 *
 * Konvensi folder plugin (meniru struktur plugin Claude Code):
 *   plugins/<id>/
 *     .claude-plugin/plugin.json   (atau plugin.json di root, legacy)
 *     skills/<nama>/SKILL.md       (atau skill.md, case-insensitive)
 *     commands/<nama>.md
 *     hooks/hooks.json
 *     .mcp.json
 *     index.js                    (legacy: tool LangChain, opsional)
 */

import fs from "fs/promises";
import fssync from "fs";
import path from "path";
import os from "os";
import { wrapUntrustedContent } from "./promptSafety.js";

const ROOT = process.cwd();
const SKILL_DIR = path.join(ROOT, "skill");
const PLUGINS_DIR = path.join(ROOT, "plugins");

// ── Helpers ──────────────────────────────────────────────────────────────

/** Bersihkan 1 segmen nama (bukan keseluruhan invocation — jangan dipakai buat string yang masih mengandung ":"). */
function sanitizeSegment(raw) {
  return (raw || "")
    .toLowerCase()
    .trim()
    .replace(/^\/+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "");
}

/**
 * Parse teks yang diketik user setelah "/" jadi { namespace, name }.
 * `namespace` null berarti user gak nulis prefix "plugin:" — bisa jadi
 * skill bawaan, ATAU shorthand ke plugin (diresolve di resolveCandidates).
 * Contoh: "ponytail:ponytail-audit" -> { namespace: "ponytail", name: "ponytail-audit" }
 *         "obsidian_vault"          -> { namespace: null, name: "obsidian_vault" }
 */
function parseInvocation(rawName) {
  const trimmed = (rawName || "").trim().replace(/^\/+/, "");
  if (!trimmed) return { namespace: null, name: "" };
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx === -1) return { namespace: null, name: sanitizeSegment(trimmed) };
  return {
    namespace: sanitizeSegment(trimmed.slice(0, colonIdx)),
    name: sanitizeSegment(trimmed.slice(colonIdx + 1)),
  };
}

/** Cari skill.md/SKILL.md di suatu folder, case-insensitive. */
async function findSkillFile(dirPath) {
  try {
    const files = await fs.readdir(dirPath);
    const hit = files.find((f) => f.toLowerCase() === "skill.md");
    if (!hit) return null;
    const full = path.join(dirPath, hit);
    const stat = await fs.stat(full).catch(() => null);
    return stat?.isFile() ? full : null;
  } catch {
    return null;
  }
}

/** Parse frontmatter YAML sederhana (key: value per baris) di awal file .md, dipakai command plugin. */
function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: content };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) meta[kv[1].trim()] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: content.slice(m[0].length) };
}

// ── Scan: built-in skills (./skill/<nama>/) ─────────────────────────────

async function scanBuiltinSkills() {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(SKILL_DIR, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.endsWith(".disabled")) continue;

    const dir = path.join(SKILL_DIR, e.name);
    const mdPath = await findSkillFile(dir);
    if (!mdPath) continue;

    let description = null;
    let categories = [];
    let version = null;
    try {
      const metaRaw = await fs.readFile(path.join(dir, "meta.json"), "utf8");
      const m = JSON.parse(metaRaw);
      description = m.description || null;
      categories = Array.isArray(m.categories) ? m.categories : [];
      version = m.version || null;
    } catch { /* meta.json opsional */ }

    // Frontmatter di skill.md (format Hermes/Claude Code) override meta.json
    // kalau ada. Bikin backfill opsional tanpa breaking skill lama yang
    // masih meta.json-only.
    try {
      const mdRaw = await fs.readFile(mdPath, "utf8");
      const { meta } = parseFrontmatter(mdRaw);
      if (meta.description) description = meta.description;
      if (meta.categories) {
        categories = String(meta.categories).split(",").map((c) => c.trim()).filter(Boolean);
      }
      if (meta.version) version = meta.version;
    } catch { /* noop */ }

    out.push({
      id: e.name,
      namespace: null,           // skill bawaan gak pakai namespace
      name: sanitizeSegment(e.name),
      slashName: sanitizeSegment(e.name), // bentuk kanonik utk ditampilkan
      kind: "skill",
      source: "builtin",
      pluginId: null,
      description,
      categories,
      version,
      mdPath,
    });
  }
  return out;
}

// ── Scan: plugin skills & commands (./plugins/<id>/{skills,commands}/) ──

async function scanPluginSkillsAndCommands() {
  const out = [];
  let pluginDirs;
  try {
    pluginDirs = await fs.readdir(PLUGINS_DIR, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const pd of pluginDirs) {
    if (!pd.isDirectory()) continue;
    const pluginId = sanitizeSegment(pd.name);
    const pluginRoot = path.join(PLUGINS_DIR, pd.name);

    // skills/<nama>/SKILL.md (format nested, standar Claude Code — dipakai
    // plugin nyata seperti ponytail) ATAU skills/<nama>.md (format flat,
    // dipakai beberapa engine plugin lain seperti Elynisia) — dua-duanya
    // didukung supaya plugin dari ekosistem manapun langsung kebaca.
    const skillsDir = path.join(pluginRoot, "skills");
    try {
      const skillEntries = await fs.readdir(skillsDir, { withFileTypes: true });
      for (const se of skillEntries) {
        let dir, mdPath, rawId;
        if (se.isDirectory()) {
          dir = path.join(skillsDir, se.name);
          mdPath = await findSkillFile(dir);
          rawId = se.name;
        } else if (se.isFile() && se.name.toLowerCase().endsWith(".md")) {
          mdPath = path.join(skillsDir, se.name);
          rawId = se.name.replace(/\.md$/i, "");
        }
        if (!mdPath) continue;

        let description = null;
        let categories = [];
        if (dir) {
          try {
            const metaRaw = await fs.readFile(path.join(dir, "meta.json"), "utf8");
            const m = JSON.parse(metaRaw);
            description = m.description || null;
            categories = Array.isArray(m.categories) ? m.categories : [];
          } catch { /* opsional */ }
        }
        if (!description || !categories.length) {
          try {
            const raw = await fs.readFile(mdPath, "utf8");
            const { meta, body } = parseFrontmatter(raw);
            if (!description) description = meta.description || body.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "") || null;
            if (!categories.length && meta.categories) {
              categories = String(meta.categories).split(",").map((c) => c.trim()).filter(Boolean);
            }
          } catch { /* noop */ }
        }

        const name = sanitizeSegment(rawId);
        out.push({
          id: rawId,
          namespace: pluginId,
          name,
          slashName: `${pluginId}:${name}`, // bentuk kanonik — SELALU unik
          kind: "skill",
          source: `plugin:${pluginId}`,
          pluginId,
          pluginDir: pluginRoot,
          description,
          categories,
          mdPath,
        });
      }
    } catch { /* plugin ini gak punya skills/ */ }

    // commands/<nama>.md ATAU commands/<nama>.toml (format Codex/beberapa
    // host lain: `description = "..."` + `prompt = "..."` alih-alih
    // markdown+frontmatter — ditemukan di plugin nyata seperti ponytail).
    const commandsDir = path.join(pluginRoot, "commands");
    try {
      const cmdFiles = await fs.readdir(commandsDir, { withFileTypes: true });
      for (const cf of cmdFiles) {
        if (!cf.isFile()) continue;
        const isMd = cf.name.toLowerCase().endsWith(".md");
        const isToml = cf.name.toLowerCase().endsWith(".toml");
        if (!isMd && !isToml) continue;

        const rawName = cf.name.replace(/\.(md|toml)$/i, "");
        const mdPath = path.join(commandsDir, cf.name);

        let description = null;
        try {
          const raw = await fs.readFile(mdPath, "utf8");
          if (isToml) {
            description = parseTomlCommand(raw).description;
          } else {
            const { meta } = parseFrontmatter(raw);
            description = meta.description || null;
          }
        } catch { /* noop */ }

        const name = sanitizeSegment(rawName);
        out.push({
          id: rawName,
          namespace: pluginId,
          name,
          slashName: `${pluginId}:${name}`, // bentuk kanonik, mis. "ponytail:ponytail-audit"
          kind: "command",
          format: isToml ? "toml" : "md",
          source: `plugin:${pluginId}`,
          pluginId,
          pluginDir: pluginRoot,
          description,
          mdPath,
        });
      }
    } catch { /* plugin ini gak punya commands/ */ }
  }
  return out;
}

/**
 * Daftar lengkap semua skill+command yang dikenal (built-in + plugin).
 * Dipakai untuk katalog [AVAILABLE SKILLS] di system prompt DAN untuk
 * menu `/skills` di TUI. Dibaca langsung dari disk tiap dipanggil — jadi
 * plugin yang baru saja diinstall LANGSUNG muncul di sini tanpa restart.
 */
// ── Cache listAll (PERF) ────────────────────────────────────────────────────
// scanBuiltinSkills + scanPluginSkillsAndCommands baca disk tiap panggil
// (47-264ms). Cache hasil, invalidate otomatis kalau mtime skill/ atau
// plugins/ berubah — jadi install/uninstall skill tetap live tanpa restart.
const GLOBAL_SKILLS_DIRS = [
  path.join(os.homedir(), ".emora", "skills"),
  path.join(os.homedir(), ".agents", "skills"),
  path.join(os.homedir(), ".gemini", "skills"),
  path.join(os.homedir(), ".gemini", "antigravity-cli", "builtin", "skills"),
];

async function scanGlobalSkills() {
  const out = [];
  const visitedDirs = new Set();

  for (const baseDir of GLOBAL_SKILLS_DIRS) {
    if (!fssync.existsSync(baseDir)) continue;

    let entries;
    try {
      entries = await fs.readdir(baseDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.endsWith(".disabled")) continue;

      const dir = path.join(baseDir, e.name);
      if (visitedDirs.has(dir)) continue;
      visitedDirs.add(dir);

      const mdPath = await findSkillFile(dir);
      if (!mdPath) continue;

      let description = null;
      let categories = [];
      let version = null;

      try {
        const mdRaw = await fs.readFile(mdPath, "utf8");
        const { meta } = parseFrontmatter(mdRaw);
        if (meta.description) description = meta.description;
        if (meta.categories) {
          categories = String(meta.categories).split(",").map((c) => c.trim()).filter(Boolean);
        }
        if (meta.version) version = meta.version;
      } catch { /* noop */ }

      out.push({
        id: e.name,
        namespace: "global",
        name: sanitizeSegment(e.name),
        slashName: `global:${sanitizeSegment(e.name)}`,
        kind: "skill",
        source: "global",
        pluginId: "global",
        description: description || `Global skill (${e.name})`,
        categories,
        version,
        mdPath,
      });
    }
  }
  return out;
}

// ── Cache listAll (PERF) ────────────────────────────────────────────────────
let _listAllCache = null;
let _listAllCacheKey = "";

async function _dirMtimeKey() {
  const fsSync = await import("fs");
  const keys = [];
  const checkDirs = [
    SKILL_DIR,
    path.join(process.cwd(), "plugins"),
    ...GLOBAL_SKILLS_DIRS,
  ];
  for (const dir of checkDirs) {
    try {
      const st = await fsSync.promises.stat(dir);
      keys.push(`${dir}:${Math.floor(st.mtimeMs / 1000)}`);
    } catch { keys.push(`${dir}:none`); }
  }
  return keys.join("|");
}

export async function listAll() {
  const key = await _dirMtimeKey();
  if (_listAllCache && key === _listAllCacheKey) return _listAllCache;

  const [builtin, globalSkills, plugin] = await Promise.all([
    scanBuiltinSkills(),
    scanGlobalSkills(),
    scanPluginSkillsAndCommands(),
  ]);
  _listAllCache = [...builtin, ...globalSkills, ...plugin];
  _listAllCacheKey = key;
  return _listAllCache;
}

/** Paksa refresh (dipakai setelah operasi yang mengubah isi folder skill, bukan cuma mtime dir). */
export function invalidateSkillCache() {
  _listAllCache = null;
  _listAllCacheKey = "";
}

/**
 * Cari SEMUA kandidat yang cocok dengan apa yang diketik user setelah "/".
 * Ini yang dipakai internal buat mendeteksi ambiguity — lihat resolve()
 * untuk versi yang mengembalikan 1 entry saja (dipakai kebanyakan caller).
 *
 * - "plugin:nama"  -> HANYA cari di plugin itu, exact match (0 atau 1 hasil
 *                     SETELAH dedup — lihat catatan dedup di bawah).
 * - "nama" (bare)  -> cari skill bawaan dengan nama itu (0 atau 1 hasil,
 *                     built-in SELALU menang atas shorthand plugin supaya
 *                     skill bawaan gak pernah ke-shadow plugin luar);
 *                     kalau gak ketemu di bawaan, cari SEMUA entry plugin
 *                     yang `name`-nya (tanpa namespace) cocok — bisa lebih
 *                     dari satu kalau beberapa plugin punya command senama.
 *
 * DEDUP dalam 1 plugin: banyak plugin nyata (mis. ponytail) sengaja
 * menaruh `skills/<nama>/SKILL.md` DAN `commands/<nama>.md|toml` dengan
 * NAMA SAMA — bukan 2 kapabilitas beda, itu 1 kapabilitas yang sama
 * diekspos 2 cara buat kompatibilitas host lain (mis. Antigravity CLI
 * mengubah command jadi skill). Kalau kandidat kolisi nama itu DATANG
 * DARI PLUGIN YANG SAMA, jangan dianggap ambigu — pilih salah satu
 * (prioritas "command", karena folder commands/ itu sumber-kebenaran
 * eksplisit-nya Claude Code buat slash command manual). Ambiguity
 * SUNGGUHAN cuma kalau nama sama itu datang dari PLUGIN BERBEDA.
 */
export async function resolveCandidates(rawName) {
  const { namespace, name } = parseInvocation(rawName);
  if (!name) return [];
  const all = await listAll();

  let matches;
  if (namespace) {
    matches = all.filter((s) => s.pluginId === namespace && s.name === name);
  } else {
    const builtinHit = all.find((s) => s.source === "builtin" && s.name === name);
    matches = builtinHit ? [builtinHit] : all.filter((s) => s.pluginId && s.name === name);
  }

  return dedupeSamePluginDuplicates(matches);
}

function dedupeSamePluginDuplicates(matches) {
  const byPluginAndName = new Map(); // "pluginId:name" -> entry terpilih
  const kindPriority = { command: 2, skill: 1 };

  for (const m of matches) {
    const key = m.pluginId ? `${m.pluginId}:${m.name}` : `builtin:${m.name}`;
    const existing = byPluginAndName.get(key);
    if (!existing || (kindPriority[m.kind] || 0) > (kindPriority[existing.kind] || 0)) {
      byPluginAndName.set(key, m);
    }
  }
  return Array.from(byPluginAndName.values());
}

/**
 * Cari SATU skill/command berdasarkan nama yang diketik user setelah "/".
 * Return null kalau gak ketemu ATAU ambigu (lebih dari 1 kandidat) — pemanggil
 * yang butuh tahu soal ambiguity (core/chat.js `ask()`, buat kasih pesan
 * "sebutkan salah satu") pakai resolveCandidates() langsung, bukan ini.
 */
export async function resolve(rawName) {
  const candidates = await resolveCandidates(rawName);
  return candidates.length === 1 ? candidates[0] : null;
}

/** Parse minimal TOML command file (`description = "..."` + `prompt = "..."`), format Codex-style. */
function parseTomlCommand(content) {
  const descMatch = content.match(/^description\s*=\s*"((?:[^"\\]|\\.)*)"/m);
  const promptMatch = content.match(/^prompt\s*=\s*"((?:[^"\\]|\\.)*)"/m);
  const unescape = (s) => s.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  return {
    description: descMatch ? unescape(descMatch[1]) : null,
    body: promptMatch ? unescape(promptMatch[1]) : content,
  };
}

/**
 * Baca isi lengkap 1 entry (skill atau command), substitusi placeholder
 * `$ARGUMENTS` (konvensi command Claude Code) kalau ada, substitusi
 * `${CLAUDE_PLUGIN_ROOT}`/`${PLUGIN_ROOT}` ke path absolut folder plugin
 * (dipakai skill/command yang merujuk script bawaan plugin, sama seperti
 * yang dipakai hook — lihat core/pluginHooks.js), dan kembalikan teks
 * siap-suntik ke prompt.
 */
export async function readContent(entry, argsString = "") {
  const raw = await fs.readFile(entry.mdPath, "utf8");
  let body;
  if (entry.format === "toml") {
    body = parseTomlCommand(raw).body;
  } else {
    body = entry.kind === "command" ? parseFrontmatter(raw).body : raw;
  }

  if (entry.pluginDir) {
    body = body
      .replaceAll("${CLAUDE_PLUGIN_ROOT}", entry.pluginDir)
      .replaceAll("${PLUGIN_ROOT}", entry.pluginDir);
  }

  // Substitusi `$ARGUMENTS` itu konvensi Claude Code KHUSUS UNTUK COMMAND
  // (commands/<nama>.md|toml) — sengaja TIDAK diterapkan ke skill (SKILL.md),
  // soalnya skill sering kali dokumentasi/panduan panjang yang isinya boleh
  // saja MENYEBUT literal teks "$ARGUMENTS" sebagai penjelasan (persis kasus
  // di skill/guide-emora sendiri, yang menjelaskan fitur ini) — kalau ikut
  // disubstitusi, teks dokumentasi itu rusak diam-diam DAN argumen user gak
  // pernah keliatan ke-append (karena hadPlaceholder jadi true padahal itu
  // false-positive, bukan placeholder sungguhan).
  const hasPlaceholder = entry.kind === "command" && /\$ARGUMENTS/.test(body);
  const substituted = hasPlaceholder ? body.replaceAll("$ARGUMENTS", argsString || "") : body;
  return { content: substituted, hadArgsPlaceholder: hasPlaceholder };
}

/**
 * Bangun instruksi manual-invocation siap kirim ke LLM lewat ask().
 * Dipakai dari core/chat.js saat mendeteksi user mengetik `/<skill> ...`.
 */
export async function buildDirective(entry, argsString = "") {
  const { content: rawContent, hadArgsPlaceholder } = await readContent(entry, argsString);
  const kindLabel = entry.kind === "command" ? "Command" : "Skill";
  const argsLine =
    argsString && !hadArgsPlaceholder
      ? `\n\n[ARGUMEN TAMBAHAN DARI USER]\n${argsString}`
      : "";

  // Konten dari plugin PIHAK KETIGA (bukan skill bawaan EMORA) dibungkus
  // penanda provenance + dicek pola prompt-injection — lihat
  // core/promptSafety.js. Skill bawaan (source === "builtin") gak perlu
  // ini karena sumbernya operator EMORA sendiri, sama seperti AGENT.md/SOUL.md.
  const content = entry.source === "builtin"
    ? rawContent
    : wrapUntrustedContent(rawContent, { source: entry.pluginId || entry.source, kind: entry.kind });

  return (
    `[MANUAL ${kindLabel.toUpperCase()} INVOCATION — user mengetik "/${entry.slashName}" secara langsung]\n` +
    `User secara eksplisit meminta ${kindLabel.toLowerCase()} "${entry.id}" (sumber: ${entry.source}) dijalankan SEKARANG. ` +
    `Ikuti instruksi di bawah ini persis, JANGAN bertanya dulu apakah boleh menjalankannya — user sudah memilihnya secara manual:\n\n` +
    `${content}` +
    argsLine
  );
}

/** Ringkas untuk baris katalog `[AVAILABLE SKILLS]`. */
export function toCatalogLine(entry) {
  const tag = entry.kind === "command" ? "command" : "skill";
  const desc = entry.description || "(tanpa deskripsi)";
  const cat = Array.isArray(entry.categories) && entry.categories.length
    ? ` {${entry.categories.join(",")}}`
    : "";
  return `- /${entry.slashName} [${tag}${cat}]: ${desc}`;
}

/** Pesan siap-tampil kalau shorthand bare-name ternyata ambigu (>1 plugin punya nama sama). */
export function formatAmbiguityMessage(rawName, candidates) {
  const options = candidates.map((c) => `/${c.slashName}`).join(", ");
  return `⚠️ "/${sanitizeSegment(rawName)}" ada di lebih dari satu plugin. Sebutkan salah satu: ${options}`;
}

export default { listAll, resolve, resolveCandidates, readContent, buildDirective, toCatalogLine, formatAmbiguityMessage };
