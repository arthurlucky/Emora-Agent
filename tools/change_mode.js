/**
 * tools/change_mode.js
 *
 * Ganti mode approval agent: autonomous | safe | plan.
 * Persist ke .emora/mode.json supaya TUI/gateway baca nilai sama.
 *
 * - autonomous: default. Tool write ringan auto-approve (LIGHT_WRITE_TOOLS).
 * - safe:       semua tool non-read-only wajib approval user.
 * - plan:       HARD BLOCK semua tool yang tidak read-only (kecuali
 *               change_mode sendiri). Untuk "rancang dulu, jangan sentuh".
 */
import fs from "fs/promises";
import path from "path";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const MODE_FILE = ".emora/mode.json";
const VALID_MODES = ["autonomous", "safe", "plan"];

// Read-only tools yang tetap boleh di mode plan.
const PLAN_ALLOWED = new Set([
  "read_file", "list_files", "search_text", "find_folder",
  "datetime", "system_monitor", "knowledge_library", "read_skill",
  "session_memory", "change_mode", "undo", "redo", "patch",
]);

export async function getMode() {
  try {
    const raw = JSON.parse(await fs.readFile(MODE_FILE, "utf8"));
    return VALID_MODES.includes(raw.mode) ? raw.mode : "autonomous";
  } catch {
    return "autonomous";
  }
}

export async function setMode(mode) {
  if (!VALID_MODES.includes(mode)) {
    return { ok: false, error: `Mode tidak valid: ${mode}. Pilihan: ${VALID_MODES.join(", ")}` };
  }
  await fs.mkdir(path.dirname(MODE_FILE), { recursive: true });
  await fs.writeFile(MODE_FILE, JSON.stringify({ mode, ts: Date.now() }));
  return { ok: true, mode };
}

/** Cek apakah tool boleh jalan di mode saat ini.
 *  DEFAULT-DENY di mode plan: hanya tool di whitelist yang lolos —
 *  tool MCP/plugin baru otomatis diblok (aman by default). */
export async function isToolAllowed(name, mode) {
  if (mode === "plan") return PLAN_ALLOWED.has(name);
  return true; // safe/autonomous: biarkan logika lama yang memutuskan
}

const changeModeTool = new DynamicStructuredTool({
  name: "change_mode",
  description: "Ganti mode operasi agent. 'plan' = hard-block semua tool yang mengubah state (hanya baca). 'safe' = semua tool tulis wajib approval. 'autonomous' = default, tool tulis ringan auto-approve.",
  schema: z.object({
    mode: z.enum(["autonomous", "safe", "plan"]).describe("Mode baru"),
  }),
  func: async ({ mode }) => {
    const r = await setMode(mode);
    if (!r.ok) return `❌ ${r.error}`;
    const labels = {
      autonomous: "🟢 AUTONOMOUS — tool tulis ringan auto-approve",
      safe: "🟡 SAFE — semua tool tulis wajib approval user",
      plan: "🔵 PLAN — hanya tool read-only, perubahan state diblok",
    };
    return `✅ Mode diganti ke ${mode}.\n${labels[mode]}`;
  },
});

export default changeModeTool;
