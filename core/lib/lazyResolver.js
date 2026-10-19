/**
 * core/lib/lazyResolver.js
 *
 * Pure logic lazy-tool resolver (tanpa I/O) — bisa di-unit-test.
 * Sumber grup/nama: core/toolManifest.js.
 *
 * Aturan:
 *  - contextTokens >= bypassThreshold → full set (fail-open).
 *  - smalltalk murni → [] (tanpa tool).
 *  - prompt kompleks/eksplisit → full set.
 *  - selain itu: keyword match + ESSENTIAL selalu ikut.
 *  - tidak ada match → full set (fail-open, bukan filter buta).
 */
import { essentialTools, canonicalName } from "../toolManifest.js";

const SMALLTALK_RE = /^(hai|halo+|hi|hei|hy|hello|hey|p+ag+i|si+ang|so+re|ma+lam|thanks?|thx|makasih|terima\s*kasih|oke*|ok|sip|mantap|ya|iya|gpp|santai|wkwk+|haha+|bye|dadah|see\s*ya)[\s!.,?]*$/i;

const RULES = [
  { re: /\b(search|cari|google|web|http|url|buka|link|website|berita|news|harga|terbaru|terkini|crypto|btc|saham|cuaca|tavily|fetch)\b/i, tools: ["search_web", "fetch_page"] },
  { re: /\b(file|baca|tulis|edit|patch|folder|direktori|zip|kompres|buat|hapus|undo|redo|download|unduh|upload|list|read|write)\b/i, tools: ["read_file", "write_file", "patch", "list_files", "search_text", "find_folder", "create_folder", "delete_folder", "zip_compress", "zip_extract", "undo", "redo"] },
  { re: /\b(cmd|command|perintah|terminal|bash|shell|exec|git|commit|push|npm|node|python|run|install|verify|check|linter|cpu|ram|code|script|program|debug|error|bug|project|proyek|task|tugas|plan|monitor|health|status|test)\b/i, tools: ["bash", "verify", "git_manager", "project_manager", "system_monitor"] },
  { re: /\b(fakta|memori|ingat|knowledge|artikel|buku|dokumen|skill|learn|artifact|laporan|todo|checklist|biaya|cost|token|usage|pemakaian|library|mode)\b/i, tools: ["session_memory", "knowledge_library", "skill_factory", "artifact_tool", "todo_write", "cost_status", "change_mode", "datetime"] },
  { re: /\b(send|kirim|pesan|group|broadcast|grup|jadwal|cron|scheduler)\b/i, tools: ["group_manager", "title_generator", "scheduler"] },
  { re: /\b(subagent|sub.?agent|delegasi|delegat|background|latar\s*belakang|spawn|inbox|parallel|swarm)\b/i, tools: ["invoke_subagent", "send_message", "manage_subagents", "swarm_delegate", "subagent"] },
  { re: /\b(hub|community|komunitas|pasang plugin)\b/i, tools: ["emora_hub"] },
];

export function shouldBypass(contextTokens, bypassThreshold = 32_000) {
  const n = Number(contextTokens);
  if (!Number.isFinite(n) || n <= 0) return false;
  return n >= bypassThreshold;
}

export function resolveLazyToolNames(inputPrompt, { contextTokens = null, bypassThreshold = 32_000 } = {}) {
  if (!inputPrompt || typeof inputPrompt !== "string") return { mode: "full", names: null };
  if (shouldBypass(contextTokens, bypassThreshold)) return { mode: "bypass-large-context", names: null };

  const text = inputPrompt.trim();
  const lower = text.toLowerCase();
  if (!text) return { mode: "full", names: null };
  if (SMALLTALK_RE.test(lower)) return { mode: "smalltalk", names: [] };
  if (lower.includes("semua tool") || lower.includes("lengkap") || text.length > 600) {
    return { mode: "full", names: null };
  }

  const matched = new Set();
  for (const r of RULES) {
    if (r.re.test(text)) r.tools.forEach((t) => matched.add(canonicalName(t)));
  }
  if (matched.size === 0) return { mode: "full", names: null };

  essentialTools().forEach((t) => matched.add(t));
  // Normalisasi alias → kanonik.
  const names = [...matched].map((n) => canonicalName(n));
  return { mode: "filtered", names: [...new Set(names)] };
}

export function filterToolsByNames(allTools, names) {
  if (!names) return allTools;
  const want = new Set(names.map((n) => canonicalName(n)));
  // Fail-open: jika hasil filter kosong (nama usang), kembalikan full set.
  const out = allTools.filter((t) => want.has(canonicalName(t.name)));
  return out.length ? out : allTools;
}
