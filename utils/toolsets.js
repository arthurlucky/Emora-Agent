/**
 * utils/toolsets.js
 *
 * Toolset system: grup tool bisa on/off lewat preset. Disimpan di
 * .emora/toolset.json. Dipakai core/tools.js untuk memfilter tool
 * sebelum di-bind ke LLM (hemat token & fokus agent).
 *
 * Sumber grup/nama: core/toolManifest.js (tunggal). File ini hanya
 * menangani persistensi config + filter — bukan definisi daftar tool.
 */
import fs from "fs/promises";
import { TOOL_GROUPS, PRESET_GROUPS, toolsByGroup, canonicalName, knownToolNames } from "../core/toolManifest.js";

const TOOLSET_FILE = ".emora/toolset.json";

// Ekspor dengan nama lama agar import lama tidak pecah.
// Dibangun dinamis dari manifest (termasuk alias legacy).
function buildLegacyGroups() {
  const out = {};
  for (const g of Object.keys(TOOL_GROUPS)) out[g] = toolsByGroup(g);
  // Alias legacy yang dulu hardcoded tersebar:
  out.web = [...new Set([...out.web])];
  out.dev = [...new Set([...out.dev, "todo_write", "cost_status", "change_mode", "patch"])];
  out.agents = [...new Set([...out.agents, "scheduler", "invoke_subagent", "send_message", "manage_subagents"])];
  return out;
}

const LEGACY_GROUPS = buildLegacyGroups();

export { TOOL_GROUPS, PRESET_GROUPS as PRESETS };
// Kompat: kode lama import TOOL_GROUPS sebagai map grup→tools.
export const TOOL_GROUP_TOOLS = LEGACY_GROUPS;

async function loadConfig() {
  try {
    const cfg = JSON.parse(await fs.readFile(TOOLSET_FILE, "utf8"));
    if (!Array.isArray(cfg.groups)) return { groups: Object.keys(TOOL_GROUPS) };
    // Sanitasi: buang grup tak dikenal.
    const clean = cfg.groups.filter((g) => TOOL_GROUPS[g]);
    return { groups: clean.length ? clean : Object.keys(TOOL_GROUPS) };
  } catch { return { groups: Object.keys(TOOL_GROUPS) }; }
}

export async function getActiveGroups() {
  return (await loadConfig()).groups;
}

export async function setGroups(groups) {
  const clean = [...new Set(groups)].filter((g) => TOOL_GROUPS[g]);
  if (!clean.length) throw new Error(`Grup kosong/tak dikenal. Pilihan: ${Object.keys(TOOL_GROUPS).join(", ")}`);
  await fs.mkdir(".emora", { recursive: true });
  await fs.writeFile(TOOLSET_FILE, JSON.stringify({ groups: clean }, null, 2));
}

/** Nama-nama tool yang AKTIF (kanonik + alias legacy dari grup aktif). */
export async function activeToolNames() {
  const groups = await getActiveGroups();
  const names = new Set();
  for (const g of groups) {
    for (const t of (LEGACY_GROUPS[g] || [])) {
      names.add(t);
      names.add(canonicalName(t));
    }
  }
  return names;
}

/** Terapkan filter ke array tool LangChain. Tool tanpa grup = selalu lolos. */
export async function applyToolset(tools) {
  const active = await activeToolNames();
  const known = knownToolNames();
  return tools.filter((t) => {
    const canon = canonicalName(t.name);
    if (!known.has(t.name) && !known.has(canon)) return true; // MCP/plugin: lolos
    return active.has(t.name) || active.has(canon);
  });
}

export async function applyPreset(preset) {
  const groups = PRESET_GROUPS[preset];
  if (!groups) throw new Error(`Preset tidak dikenal: ${preset}. Pilihan: ${Object.keys(PRESET_GROUPS).join(", ")}`);
  await setGroups(groups);
  return groups;
}

/** Status ringkas per grup untuk display. */
export async function statusSummary() {
  const cfg = await loadConfig();
  const lines = [];
  for (const g of Object.keys(TOOL_GROUPS)) {
    const on = cfg.groups.includes(g);
    lines.push(`${on ? "✅" : "🚫"} ${g.padEnd(10)} (${(LEGACY_GROUPS[g] || []).length} tools)`);
  }
  lines.push(`\nPreset: ${Object.keys(PRESET_GROUPS).join(", ")}`);
  return lines.join("\n");
}
