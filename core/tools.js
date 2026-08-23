import { DynamicStructuredTool } from "@langchain/core/tools";
import { SearchWebTool } from "../tools/search_web.js";

import { listFilesTool } from "../tools/list_file.js";
import { readFileTool } from "../tools/read_file.js";
import { writeFileTool } from "../tools/write_file.js";
import { datetimeTool } from "../tools/datetime.js";
import { shellExecTool } from "../tools/shell_exec.js";
import projectManagerTool from "../tools/project_manager.js";
import { schedulerTool } from "../tools/scheduler.js";
import { FetchPageTool }from "../tools/fetch_page.js";

import groupManagerTool from "../tools/group_manager.js";

import searchTextTool from "../tools/search_text.js";
import emoraHubTool from "../tools/emora_hub.js";

import findFolderTool from "../tools/find_folder.js";

import createFolderTool from "../tools/create_folder.js";
import deleteFolderTool from "../tools/delete_folder.js";

import zipCompressTool from "../tools/zip_compress.js";
import zipExtractTool from "../tools/zip_extract.js";

import { skillFactoryTool } from "../tools/skill_factory.js";
import backupManager from "../tools/backup_manager.js";
import { systemMonitorTool } from "../tools/system_monitor.js";
import { gitManagerTool } from "../tools/git_manager.js";
import knowledgeLibraryTool from "../tools/knowledge_library.js";
import { loadMCPTools } from "../tools/mcp_bridge.js";
import { swarmDelegateTool } from "../tools/swarm_delegate.js";
import subagentTool from "../tools/subagent.js";
import titleGeneratorTool from "../tools/title_generator.js";
import { artifactTool } from "../tools/artifact_tool.js";
import { sessionMemoryTool } from "../tools/session_memory.js";
import pluginManager from "./pluginManager.js";
import { patchTool } from "../tools/patch.js";
import { undoTool, redoTool } from "../tools/undo.js";
import { verifyTool } from "../tools/verify.js";
import changeModeTool from "../tools/change_mode.js";

const tools = [
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
  subagentTool,
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

// ─────────────────────────────────────────────
// MCP external tools — spawn server stdio/http dari mcp/mcp.config.json.
// Ditambahkan SETELAH filter toolset (MCP/plugin selalu aktif).
try {
  const mcpTools = await loadMCPTools();
  if (mcpTools.length) filteredTools.push(...mcpTools);
} catch (err) {
  console.error(`  ⚠️  MCP bridge gagal dimuat: ${err.message}`);
}

export default filteredTools;
