/**
 * utils/toolsets.js
 *
 * Toolset system: grup tool bisa on/off lewat preset. Disimpan di
 * .emora/toolset.json. Dipakai core/tools.js untuk memfilter tool
 * sebelum di-bind ke LLM (hemat token & fokus agent).
 *
 * Preset bawaan:
 *   full     — semua tool aktif (default)
 *   coding   — file ops + git + shell + verify (tanpa messaging/social)
 *   chat     — read-only + web (tanpa write apapun)
 *   minimal  — core file ops saja
 */
import fs from "fs/promises";
import fsSync from "fs";

const TOOLSET_FILE = ".emora/toolset.json";

// Grup kategori: nama grup → array tool name.
export const TOOL_GROUPS = {
  files:    ["read_file", "write_file", "list_files", "search_text", "find_folder",
             "create_folder", "delete_folder", "patch", "undo", "redo", "zip_compress", "zip_extract"],
  terminal: ["shell_exec"],
  web:      ["search_web", "fetch_page", "web_research"],
  dev:      ["git_manager", "verify", "project_manager", "backup_manager", "skill_factory",
             "knowledge_library", "session_memory", "artifact_tool", "datetime", "system_monitor"],
  social:   ["group_manager", "emora_hub"],
  agents:   ["swarm_delegate", "subagent", "title_generator"],
};

export const PRESETS = {
  full:    Object.keys(TOOL_GROUPS),
  coding:  ["files", "terminal", "dev", "agents"],
  chat:    ["web", "dev"],
  minimal: ["files"],
};

async function loadConfig() {
  try { return JSON.parse(await fs.readFile(TOOLSET_FILE, "utf8")); }
  catch { return { groups: Object.keys(TOOL_GROUPS) }; }
}

export async function getActiveGroups() {
  return (await loadConfig()).groups;
}

export async function setGroups(groups) {
  await fs.mkdir(".emora", { recursive: true });
  await fs.writeFile(TOOLSET_FILE, JSON.stringify({ groups }, null, 2));
}

/** Nama-nama tool yang AKTIF berdasarkan config saat ini. */
export async function activeToolNames() {
  const groups = await getActiveGroups();
  const names = new Set();
  for (const g of groups) for (const t of (TOOL_GROUPS[g] || [])) names.add(t);
  // Tool yang tidak masuk grup manapun selalu aktif (mis. MCP bridge, plugin).
  return names;
}

/** Terapkan filter ke array tool LangChain. Tool tanpa grup = selalu lolos. */
export async function applyToolset(tools) {
  const active = await activeToolNames();
  const allKnown = new Set(Object.values(TOOL_GROUPS).flat());
  return tools.filter((t) => !allKnown.has(t.name) || active.has(t.name));
}

export async function applyPreset(preset) {
  const groups = PRESETS[preset];
  if (!groups) throw new Error(`Preset tidak dikenal: ${preset}. Pilihan: ${Object.keys(PRESETS).join(", ")}`);
  await setGroups(groups);
  return groups;
}

/** Status ringkas per grup untuk display. */
export async function statusSummary() {
  const cfg = await loadConfig();
  const lines = [];
  for (const [g, tools] of Object.entries(TOOL_GROUPS)) {
    const on = cfg.groups.includes(g);
    lines.push(`${on ? "✅" : "🚫"} ${g.padEnd(10)} (${tools.length} tools)`);
  }
  lines.push(`\nPreset: ${Object.keys(PRESETS).join(", ")}`);
  return lines.join("\n");
}
