import { DynamicStructuredTool } from "@langchain/core/tools";
import { SearchWebTool } from "../tools/search_web.js";

import { listFilesTool } from "../tools/list_file.js";
import { readFileTool } from "../tools/read_file.js";
import { writeFileTool } from "../tools/write_file.js";
import { datetimeTool } from "../tools/datetime.js";
import { shellExecTool } from "../tools/shell_exec.js";
import projectManagerTool from "../tools/proj.js";
import { schedulerTool } from "../tools/scheduler.js";
import { FetchPageTool }from "../tools/fetch_page.js";

import groupManagerTool from "../tools/group.js";

import searchTextTool from "../tools/search_text.js";
import emoraHubTool from "../tools/emora_hub.js";

import findFolderTool from "../tools/find_folder.js";

import createFolderTool from "../tools/create_folder.js";
import deleteFolderTool from "../tools/delete_folder.js";

import zipCompressTool from "../tools/zip_compress.js";
import zipExtractTool from "../tools/zip_extract.js";

import { skillFactoryTool } from "../tools/skill_factory.js";
import backupManager from "../tools/backup_manager.js";
import { systemMonitorTool } from "../tools/sys.js";
import { gitManagerTool } from "../tools/git_manager.js";
import knowledgeLibraryTool from "../tools/kl.js";
import { loadMCPTools } from "../tools/mcp_bridge.js";
import { swarmDelegateTool } from "../tools/swarm.js";
import titleGeneratorTool from "../tools/title.js";
import { artifactTool } from "../tools/artifact.js";
import { sessionMemoryTool } from "../tools/mem.js";
import pluginManager from "./pluginManager.js";
import fsSync from "fs";
import { patchTool } from "../tools/patch.js";
import { undoTool, redoTool } from "../tools/undo.js";
import { verifyTool } from "../tools/verify.js";
import changeModeTool from "../tools/change_mode.js";
import { botMeshTool } from "../tools/bot_mesh.js";
import { invokeSubagentTool, sendMessageTool, manageSubagentsTool } from "../tools/ag_subagents.js";

const tools = [
  invokeSubagentTool,
  sendMessageTool,
  manageSubagentsTool,
  botMeshTool,
  SearchWebTool,
  FetchPageTool,

  listFilesTool,
  readFileTool,
  writeFileTool,

  searchTextTool,
  findFolderTool,

  createFolderTool,
  deleteFolderTool,

  zipCompressTool,
  zipExtractTool,
  
  datetimeTool,
  shellExecTool,
  projectManagerTool,
  schedulerTool,

  skillFactoryTool,
  backupManager,
  systemMonitorTool,
  emoraHubTool,
  gitManagerTool,
  
  groupManagerTool,
  knowledgeLibraryTool,
  swarmDelegateTool,
  titleGeneratorTool,
  artifactTool,
  sessionMemoryTool,
  patchTool,
  undoTool,
  redoTool,
  verifyTool,
  changeModeTool,
];

// ─────────────────────────────────────────────
// PLUGIN SYSTEM — live enable/disable/reload (core/pluginManager.js)
//
// Setiap tool built-in di atas dibungkus 1 lapis indirection: implementasi
// aslinya didaftarkan ke pluginManager sebagai "live impl", lalu tool yang
// benar-benar di-bind ke LLM adalah versi WRAPPER yang, tiap kali dipanggil,
// mengecek status enabled/disabled dan mengambil implementasi TERBARU dari
// pluginManager (bukan implementasi yang di-capture sekali saat startup).
// Ini yang membuat `emora plugin disable/enable/reload <nama>` langsung
// berlaku tanpa perlu restart proses gateway — lihat penjelasan lengkap di
// core/pluginManager.js.
// ─────────────────────────────────────────────
function wrapWithToggle(tool) {
  // Pakai tool.invoke(input) alih-alih tool.func(input) langsung — beberapa
  // tool built-in (mis. group_manager.js) dibuat pakai helper `tool()` dari
  // LangChain, bukan `new DynamicStructuredTool({...})`, dan hasilnya TIDAK
  // selalu expose `.func` sebagai properti publik (tergantung versi
  // LangChain yang terpasang) — sempat menyebabkan crash
  // "Cannot read properties of undefined (reading 'bind')" saat startup.
  // `.invoke()` adalah bagian dari Runnable interface yang dijamin ada di
  // SEMUA tool LangChain apapun cara pembuatannya, jadi lebih aman dipakai.
  pluginManager.registerLiveImpl(tool.name, (input) => tool.invoke(input), {
    description: tool.description,
    source: "builtin",
  });

  return new DynamicStructuredTool({
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
    func: async (input) => {
      if (!pluginManager.isEnabled(tool.name)) {
        return `⚠️ Tool "${tool.name}" sedang DINONAKTIFKAN oleh admin (lihat \`emora plugin enable ${tool.name}\` untuk mengaktifkan kembali).`;
      }
      const liveFunc = pluginManager.getLiveImpl(tool.name) || ((i) => tool.invoke(i));
      return liveFunc(input);
    },
  });
}

const wrappedBuiltinTools = tools.map(wrapWithToggle);

// ─────────────────────────────────────────────
// PLUGIN EKSTERNAL — dimuat dari folder ./plugins/<id>/ (dynamic loading).
// Tool dari plugin JUGA otomatis dibungkus toggle yang sama lewat
// pluginManager.registerLiveImpl (dipanggil dari dalam loadPlugin()).
// Plugin yang di-install SETELAH proses ini start baru muncul di skema tool
// LLM setelah restart gateway (batasan LLM function-calling binding-once),
// tapi status enabled/disabled tetap live untuk plugin yang SUDAH termuat.
// ─────────────────────────────────────────────
try {
  await pluginManager.loadAllPlugins();
} catch (err) {
  console.error(`  ⚠️  Gagal memuat sebagian plugin: ${err.message}`);
}

function wrapPluginTool(name, meta) {
  return new DynamicStructuredTool({
    name,
    description: meta.description,
    // Schema plugin diambil dari live impl asalnya kalau tersedia; kalau
    // tidak ada schema custom, pakai schema kosong (tool tanpa argumen).
    schema: meta.schema || undefined,
    func: async (input) => {
      if (!pluginManager.isEnabled(name)) {
        return `⚠️ Plugin tool "${name}" sedang DINONAKTIFKAN.`;
      }
      const liveFunc = pluginManager.getLiveImpl(name);
      if (!liveFunc) return `❌ Plugin tool "${name}" tidak lagi tersedia (mungkin sudah di-uninstall).`;
      return liveFunc(input);
    },
  });
}

const pluginTools = pluginManager.listPlugins().flatMap((p) =>
  p.tools.map((originalTool) =>
    wrapPluginTool(originalTool.name, {
      description: originalTool.description || "",
      schema: originalTool.schema,
    })
  )
);

const allTools = [...wrappedBuiltinTools, ...pluginTools];

// ─────────────────────────────────────────────
// TOOLSET SYSTEM — filter tool per grup preset (utils/toolsets.js).
// Tool yang tidak masuk grup manapun (MCP, plugin) selalu lolos.
// ─────────────────────────────────────────────
let filteredTools = allTools;
try {
  const { applyToolset } = await import("../utils/toolsets.js");
  filteredTools = await applyToolset(allTools);
} catch (err) {
  console.error(`  ⚠️  Toolset filter gagal, pakai semua tool: ${err.message}`);
}

/**
 * Live-reload toolset — dipanggil dari TUI/REPL setelah `toolset use/on/off`
 * tanpa restart. Mengganti isi array `filteredTools` in-place (array sama,
 * isi baru) supaya semua referensi lama tetap valid.
 */
export async function reloadToolset() {
  try {
    const { applyToolset } = await import("../utils/toolsets.js");
    const fresh = await applyToolset(allTools);
    filteredTools.length = 0;
    filteredTools.push(...fresh);
    return filteredTools.length;
  } catch (err) {
    console.error(`  ⚠️  Toolset reload gagal: ${err.message}`);
    return filteredTools.length;
  }
}

// ─────────────────────────────────────────────
// Obsidian MANUAL mode — tool filesystem vault.
// Aktif hanya kalau OBSIDIAN_VAULT_PATH dikonfigurasi di .env
// (di-set lewat `emora obsidian setup` → mode manual).
// ─────────────────────────────────────────────
if (process.env.OBSIDIAN_VAULT_PATH && fsSync.existsSync(process.env.OBSIDIAN_VAULT_PATH)) {
  try {
    const { obsidianManualTool } = await import("../tools/obsidian_manual.js");
    filteredTools.push(obsidianManualTool);
  } catch (err) {
    console.error(`  ⚠️  Obsidian manual tool gagal dimuat: ${err.message}`);
  }
}

/**
 * Lazy Tool Resolver: Filter tools by intent keyword match if prompt is specific.
 * Reduces 30+ tools payload down to 3-6 relevant tools per turn.
 */
export function resolveLazyTools(inputPrompt, allTools) {
  if (!inputPrompt || typeof inputPrompt !== "string" || !allTools?.length) return allTools || [];

  const text = inputPrompt.trim().toLowerCase();

  // Only strip tools for OBVIOUS smalltalk patterns, never based on length alone
  const SMALLTALK_RE = /^(hai|halo+|hi|hei|hy|hello|hey|p+ag+i|si+ang|so+re|ma+lam|thanks?|thx|makasih|terima\s*kasih|oke*|ok|sip|mantap|ya|iya|gpp|santai|wkwk+|haha+|bye|dadah|see\s*ya)[\s!.,?]*$/i;
  if (SMALLTALK_RE.test(text)) {
    return [];
  }

  // Return full set for complex/explicit prompts or plan mode
  if (text.includes("semua tool") || text.includes("lengkap") || text.length > 600) {
    return allTools;
  }

  const categories = {
    web: ["search_web", "fetch_page"],
    file: ["read_file", "write_file", "patch", "list_files", "search_text", "find_folder", "create_folder", "delete_folder", "zip_compress", "zip_extract", "undo", "redo"],
    terminal: ["shell_exec", "verify", "git_manager", "project_manager", "system_monitor"],
    memory: ["session_memory", "knowledge_library", "skill_factory", "artifact_tool"],
    messaging: ["group_manager", "title_generator", "scheduler_tool"],
    subagent: ["invoke_subagent", "send_message", "manage_subagents"],
    hub: ["emora_hub"],
  };

  const matched = new Set();

  if (/\b(search|cari|google|web|http|url|buka|link|website)\b/i.test(text)) {
    categories.web.forEach((t) => matched.add(t));
  }
  if (/\b(file|baca|tulis|edit|patch|folder|direktori|zip|kompres|buat|hapus|undo|redo|download|unduh|upload|unggah)\b/i.test(text)) {
    categories.file.forEach((t) => matched.add(t));
  }
  if (/\b(cmd|command|perintah|terminal|bash|shell|exec|git|commit|push|npm|node|python|run|install|verify|check|linter|cpu|ram|code|script|program|debug|error|bug|project|proyek|task|tugas|plan|monitor|pantau|health|status)\b/i.test(text)) {
    categories.terminal.forEach((t) => matched.add(t));
  }
  if (/\b(fakta|memori|ingat|knowledge|artikel|buku|dokumen|skill|learn|artifact|laporan)\b/i.test(text)) {
    categories.memory.forEach((t) => matched.add(t));
  }
  if (/\b(send|kirim|pesan|group|broadcast)\b/i.test(text)) {
    categories.messaging.forEach((t) => matched.add(t));
  }
  if (/\b(subagent|sub.?agent|agent|delegasi|delegat|background|latar\s*belakang|spawn|inbox|parallel)\b/i.test(text)) {
    categories.subagent.forEach((t) => matched.add(t));
  }
  if (/\b(hub|community|komunitas|install|pasang)\b/i.test(text)) {
    categories.hub.forEach((t) => matched.add(t));
  }

  if (matched.size === 0) return allTools;

  // Essential tools always included when any category matches
  const ESSENTIAL = ["datetime", "shell_exec", "read_file", "write_file", "session_memory"];
  ESSENTIAL.forEach((t) => matched.add(t));
  return allTools.filter((t) => matched.has(t.name));
}

export default filteredTools;
