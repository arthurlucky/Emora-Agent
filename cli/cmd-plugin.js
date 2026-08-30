/**
 * cli/cmd-plugin.js — `emora plugin`
 * Kelola tool built-in & plugin eksternal: list, disable, enable, reload, install.
 * Perubahan status (disable/enable) berlaku LIVE ke proses gateway yang sedang
 * berjalan tanpa restart — lihat penjelasan lengkap di core/pluginManager.js.
 */

import chalk from "chalk";
import fs from "fs";
import path from "path";
import { sectionHeader, sectionFooter, infoLine, successLine, warnLine, errorLine, confirm } from "./select.js";
import pluginManager from "../core/pluginManager.js";
import pluginHooks from "../core/pluginHooks.js";

const C = {
  cyan: chalk.hex("#58a6ff"),
  green: chalk.hex("#3fb950"),
  red: chalk.hex("#f85149"),
  muted: chalk.hex("#8b949e"),
};

export async function cmdPlugin(args) {
  const sub = (args[0] || "list").toLowerCase();
  const name = args[1];

  // FIX proses-boundary: tiap invocation `emora plugin ...` adalah proses
  // Node BARU (Map in-memory `loadedPlugins` di core/pluginManager.js kosong
  // lagi tiap kali) — sebelumnya cuma `install`/`reload` yang mengisi Map itu
  // (lewat loadPlugin), jadi `emora plugin list` di invocation TERPISAH
  // (setelah install sukses di invocation sebelumnya) selalu keliatan kosong
  // walau plugin-nya beneran sudah terpasang di disk. Scan ulang dari disk
  // di awal SEMUA sub-command supaya konsisten.
  await pluginManager.loadAllPlugins();

  if (sub === "list") {
    sectionHeader("EMORA Plugin", "Tool built-in & plugin eksternal");
    const all = pluginManager.listAll();
    if (all.length === 0) {
      console.log(C.muted("  Belum ada tool/plugin terdaftar."));
    } else {
      for (const p of all) {
        const status = p.enabled ? C.green("✅ enabled ") : C.red("🚫 disabled");
        console.log(`  ${status}  ${chalk.bold(p.name.padEnd(24))} ${C.muted(`[${p.source}]`)}`);
      }
    }

    const plugins = pluginManager.listPlugins();
    if (plugins.length > 0) {
      console.log("");
      console.log(chalk.bold("  Plugin eksternal terpasang:"));
      for (const p of plugins) {
        infoLine(p.id, `${p.name} v${p.version} (${p.toolCount} tool)`);
      }
    }
    sectionFooter();
    return;
  }

  if (sub === "disable") {
    if (!name) return errorLine("Gunakan: emora plugin disable <nama_tool>");
    pluginManager.disable(name);
    successLine(`Tool "${name}" dinonaktifkan (berlaku instan ke gateway yang sedang berjalan).`);
    return;
  }

  if (sub === "enable") {
    if (!name) return errorLine("Gunakan: emora plugin enable <nama_tool>");
    pluginManager.enable(name);
    successLine(`Tool "${name}" diaktifkan kembali (berlaku instan ke gateway yang sedang berjalan).`);
    return;
  }

  if (sub === "reload") {
    if (!name) return errorLine("Gunakan: emora plugin reload <plugin_id>");
    try {
      const result = await pluginManager.reloadPlugin(name);
      successLine(`Plugin "${name}" berhasil di-reload (${result.toolCount} tool, kode terbaru langsung dipakai).`);
    } catch (err) {
      errorLine(`Gagal reload: ${err.message}`);
    }
    return;
  }

  if (sub === "install") {
    const source = args[1];
    if (!source) return errorLine("Gunakan: emora plugin install <git_url_atau_path_lokal>");
    try {
      const isGit = pluginManager.looksLikeGitUrl(source);
      const result = isGit
        ? await (async () => {
            console.log(C.muted(`  ⏳ Cloning dari ${source} ...`));
            return pluginManager.installPluginFromGit(source);
          })()
        : await pluginManager.installPluginFromPath(source);
      successLine(`Plugin "${result.id}" berhasil diinstall (${result.toolCount} tool, ${result.skillCount} skill, ${result.commandCount} command${result.mcpServerCount ? `, ${result.mcpServerCount} MCP server` : ""}).`);
      if (result.toolCount || result.mcpServerCount) {
        warnLine("Tool baru dari plugin ini baru muncul di skema LLM setelah gateway di-restart (batasan LLM function-calling binding-once). Status enable/disable tool yang SUDAH termuat tetap live tanpa restart.");
      }
      if (result.skillCount || result.commandCount) {
        infoLine("Langsung bisa dipakai", `/${result.id}:<nama_skill_atau_command> — cek \`emora plugin list\` atau /help buat daftar lengkapnya`);
      }
      await promptTrustHooksIfAny(result);
    } catch (err) {
      errorLine(`Gagal install: ${err.message}`);
    }
    return;
  }

  if (sub === "trust-hooks") {
    if (!name) return errorLine("Gunakan: emora plugin trust-hooks <plugin_id>");
    const hooksPath = pluginHooks.getHooksPath(name);
    if (!fs.existsSync(hooksPath)) return errorLine(`Plugin "${name}" gak punya file hooks (dicek manifest.hooks & fallback hooks/hooks.json, dua-duanya gak ketemu).`);
    pluginHooks.trustHooks(name);
    successLine(`Hooks plugin "${name}" di-trust — akan otomatis jalan mulai sesi berikutnya (SessionStart) & tiap prompt (UserPromptSubmit).`);
    return;
  }

  if (sub === "untrust-hooks") {
    if (!name) return errorLine("Gunakan: emora plugin untrust-hooks <plugin_id>");
    pluginHooks.untrustHooks(name);
    successLine(`Hooks plugin "${name}" gak lagi dipercaya — gak akan dieksekusi lagi.`);
    return;
  }

  if (sub === "list-hooks") {
    sectionHeader("Plugin Hooks", "Hook = command shell yang jalan otomatis tiap sesi/prompt");
    const withHooks = pluginHooks.listPluginsWithHooks();
    const trusted = pluginHooks.listTrustedHooks();
    if (!withHooks.length) {
      console.log(C.muted("  Gak ada plugin terpasang yang punya hooks/hooks.json."));
    } else {
      for (const id of withHooks) {
        const isTrusted = trusted.includes(id);
        console.log(`  ${isTrusted ? C.green("✅ trusted ") : C.red("🚫 untrusted")}  ${chalk.bold(id)}`);
      }
      console.log("");
      console.log(C.muted("  Ubah lewat: emora plugin trust-hooks <id> / untrust-hooks <id>"));
    }
    sectionFooter();
    return;
  }

  if (sub === "remove" || sub === "uninstall" || sub === "delete") {
    if (!name) return errorLine("Gunakan: emora plugin remove <plugin_id>");
    try {
      const ok = await pluginManager.uninstallPlugin(name);
      if (ok) {
        successLine(`Plugin "${name}" berhasil dihapus dari direktori plugins.`);
      } else {
        errorLine(`Plugin "${name}" tidak ditemukan di folder plugins.`);
      }
    } catch (err) {
      errorLine(`Gagal menghapus plugin: ${err.message}`);
    }
    return;
  }

  console.log(C.muted("Sub-command tidak dikenal. Gunakan: list | disable <nama> | enable <nama> | reload <id> | install <path> | remove <id> | trust-hooks <id> | untrust-hooks <id> | list-hooks"));
}

/**
 * Kalau plugin yang baru diinstall punya hooks/hooks.json, hooks itu
 * TIDAK otomatis jalan (lihat core/pluginHooks.js) — sengaja, karena hook
 * = command shell arbitrary yang bisa jalan tiap sesi/tiap prompt tanpa
 * user sadar. Sama seperti Claude Code (yang mewajibkan review manual
 * sebelum hook plugin diaktifkan), di sini user diminta konfirmasi
 * eksplisit dulu, DAN ditunjukkan persis command apa yang bakal jalan.
 */
async function promptTrustHooksIfAny(result) {
  if (!result.hasHooks) return;
  const hooksPath = result.hooksPath || pluginHooks.getHooksPath(result.id);

  let commandPreview = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
    const hooksObj = parsed.hooks || parsed;
    for (const [event, entries] of Object.entries(hooksObj)) {
      for (const entry of entries || []) {
        for (const h of entry.hooks || []) {
          if (h.command) commandPreview.push(`  [${event}] ${h.command}`);
        }
      }
    }
  } catch { /* biar tetep tanya walau preview gagal dibaca */ }

  console.log("");
  warnLine(`Plugin "${result.id}" punya hooks yang akan otomatis MENJALANKAN COMMAND SHELL setiap sesi & setiap prompt kalau di-trust:`);
  for (const line of commandPreview.slice(0, 10)) console.log(C.muted(line));
  console.log("");

  const trust = await confirm(`Percayai & aktifkan hooks plugin "${result.id}" sekarang?`, { default: false });
  if (trust) {
    pluginHooks.trustHooks(result.id);
    successLine(`Hooks "${result.id}" di-trust & aktif mulai sekarang.`);
  } else {
    infoLine("Hooks belum diaktifkan", `plugin tetap bisa dipakai (skill/command/tool) — jalankan \`emora plugin trust-hooks ${result.id}\` kapan pun kalau berubah pikiran`);
  }
}

export default cmdPlugin;
