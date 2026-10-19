/**
 * core/toolManifest.js
 *
 * Sumber kebenaran tunggal untuk metadata tools agent.
 * Dipakai oleh: utils/toolsets.js (filter grup) + core/tools.js resolveLazyTools (filter intent).
 * Menutup drift hardcode ganda: nama tool, grup, essential, kebutuhan network.
 *
 * parallelSafe: false = wajib serial (Groq & beberapa backend error urutan ToolMessage).
 */

export const TOOL_MANIFEST = {
  // ── files ──
  read_file:       { group: "files", essential: true,  needsNetwork: false, parallelSafe: true },
  write_file:      { group: "files", essential: true,  needsNetwork: false, parallelSafe: true },
  list_files:      { group: "files", essential: false, needsNetwork: false, parallelSafe: true },
  search_text:     { group: "files", essential: false, needsNetwork: false, parallelSafe: true },
  find_folder:     { group: "files", essential: false, needsNetwork: false, parallelSafe: true },
  create_folder:   { group: "files", essential: false, needsNetwork: false, parallelSafe: true },
  delete_folder:   { group: "files", essential: false, needsNetwork: false, parallelSafe: false },
  patch:           { group: "files", essential: false, needsNetwork: false, parallelSafe: true },
  undo:            { group: "files", essential: true,  needsNetwork: false, parallelSafe: false },
  redo:            { group: "files", essential: true,  needsNetwork: false, parallelSafe: false },
  zip_compress:    { group: "files", essential: false, needsNetwork: false, parallelSafe: false },
  zip_extract:     { group: "files", essential: false, needsNetwork: false, parallelSafe: false },
  // ── terminal ──
  bash:            { group: "terminal", essential: true, needsNetwork: false, parallelSafe: false },
  // ── web ──
  search_web:      { group: "web", essential: false, needsNetwork: true, parallelSafe: true },
  fetch_page:      { group: "web", essential: false, needsNetwork: true, parallelSafe: true },
  // ── dev ──
  git_manager:     { group: "dev", essential: false, needsNetwork: false, parallelSafe: false },
  verify:          { group: "dev", essential: true,  needsNetwork: false, parallelSafe: false },
  project_manager: { group: "dev", essential: false, needsNetwork: false, parallelSafe: false },
  proj:            { group: "dev", essential: false, needsNetwork: false, parallelSafe: false, aliasOf: "project_manager" },
  backup_manager:  { group: "dev", essential: false, needsNetwork: false, parallelSafe: false },
  skill_factory:   { group: "dev", essential: false, needsNetwork: false, parallelSafe: false },
  knowledge_library:{ group: "dev", essential: false, needsNetwork: false, parallelSafe: true },
  kl:              { group: "dev", essential: false, needsNetwork: false, parallelSafe: true, aliasOf: "knowledge_library" },
  session_memory:  { group: "dev", essential: true,  needsNetwork: false, parallelSafe: true },
  mem:             { group: "dev", essential: false, needsNetwork: false, parallelSafe: true, aliasOf: "session_memory" },
  artifact_tool:   { group: "dev", essential: false, needsNetwork: false, parallelSafe: true },
  artifact:        { group: "dev", essential: false, needsNetwork: false, parallelSafe: true, aliasOf: "artifact_tool" },
  datetime:        { group: "dev", essential: true,  needsNetwork: false, parallelSafe: true },
  system_monitor:  { group: "dev", essential: false, needsNetwork: false, parallelSafe: true },
  sys:             { group: "dev", essential: false, needsNetwork: false, parallelSafe: true, aliasOf: "system_monitor" },
  change_mode:     { group: "dev", essential: true,  needsNetwork: false, parallelSafe: false },
  changeMode:      { group: "dev", essential: false, needsNetwork: false, parallelSafe: false, aliasOf: "change_mode" },
  todo_write:      { group: "dev", essential: true,  needsNetwork: false, parallelSafe: false },
  cost_status:     { group: "dev", essential: false, needsNetwork: false, parallelSafe: true },
  title_generator: { group: "agents", essential: false, needsNetwork: false, parallelSafe: true },
  title:           { group: "agents", essential: false, needsNetwork: false, parallelSafe: true, aliasOf: "title_generator" },
  // ── social ──
  group_manager:   { group: "social", essential: false, needsNetwork: false, parallelSafe: false },
  group:           { group: "social", essential: false, needsNetwork: false, parallelSafe: false, aliasOf: "group_manager" },
  emora_hub:       { group: "social", essential: false, needsNetwork: true, parallelSafe: true },
  // ── agents ──
  swarm_delegate:  { group: "agents", essential: false, needsNetwork: false, parallelSafe: false },
  swarm:           { group: "agents", essential: false, needsNetwork: false, parallelSafe: false, aliasOf: "swarm_delegate" },
  subagent:        { group: "agents", essential: false, needsNetwork: false, parallelSafe: false },
  invoke_subagent: { group: "agents", essential: false, needsNetwork: false, parallelSafe: false },
  send_message:    { group: "agents", essential: false, needsNetwork: false, parallelSafe: false },
  manage_subagents:{ group: "agents", essential: false, needsNetwork: false, parallelSafe: false },
  scheduler:       { group: "agents", essential: false, needsNetwork: false, parallelSafe: false },
  scheduler_tool:  { group: "agents", essential: false, needsNetwork: false, parallelSafe: false, aliasOf: "scheduler" },
};

export const TOOL_GROUPS = {
  files: "Operasi file & arsip",
  terminal: "Shell & perintah sistem",
  web: "Pencarian & fetch web",
  dev: "Development, memori, verifikasi",
  social: "Messaging & community hub",
  agents: "Subagent, swarm, scheduler",
};

export const PRESET_GROUPS = {
  full: Object.keys(TOOL_GROUPS),
  coding: ["files", "terminal", "dev", "agents"],
  chat: ["web", "dev"],
  minimal: ["files"],
};

/** Nama kanonik (ikuti alias → nama utama). */
export function canonicalName(name) {
  const m = TOOL_MANIFEST[name];
  if (!m) return name;
  return m.aliasOf || name;
}

/** Daftar tool essential — selalu ikut walau kategori lain match. */
export function essentialTools() {
  return Object.entries(TOOL_MANIFEST)
    .filter(([, m]) => m.essential && !m.aliasOf)
    .map(([n]) => n);
}

/** Grup → daftar nama kanonik (tanpa alias). */
export function toolsByGroup(group) {
  return Object.entries(TOOL_MANIFEST)
    .filter(([, m]) => m.group === group && !m.aliasOf)
    .map(([n]) => n);
}

/** Semua nama yang dikenal (termasuk alias legacy). */
export function knownToolNames() {
  return new Set(Object.keys(TOOL_MANIFEST));
}
