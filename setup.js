/**
 * setup.js — EMORA Interactive Setup
 * Dipanggil via: emora setup
 *
 * Arrow key ↑↓ + Enter untuk navigasi semua menu. Tidak ada ketik nomor
 * sama sekali (kecuali field teks bebas seperti API key/nama).
 *
 * Struktur file ini:
 *   1. .env helpers
 *   2. Banner & tampilan
 *   3. Section wizard per kategori (Provider, Gateway, Obsidian, MCP,
 *      Plugin, Advanced Behavior, Web UI, Nama, Review Konfigurasi)
 *   4. Quick Setup (dipakai first-run) vs Menu Lengkap (dipakai re-run)
 *   5. Main loop
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import ora from "ora";
import figlet from "figlet";
import boxen from "boxen";

import {
  select, confirm, input,
  sectionHeader, sectionFooter,
  infoLine, successLine, warnLine, errorLine,
} from "./cli/select.js";
import { PROVIDERS, getProviderModels, getKeyUrl } from "./provider/index.js";
import * as ollamaMod from "./provider/ollama/index.js";

const C = { line: chalk.hex("#58a6ff")("  │") };

// ─────────────────────────────────────────────
// CONFIG.YML HELPERS (core/config.js)
// ─────────────────────────────────────────────
import { getEnv, setEnv, getConfig, setConfig } from "./core/config.js";

/** Deteksi first-run: belum pernah setup provider sama sekali. */
function isFirstRun() {
  return !getEnv("MODEL_PROVIDER");
}

// ─────────────────────────────────────────────
// BANNER & TAMPILAN
// ─────────────────────────────────────────────
function showSetupBanner() {
  console.clear();
  const logo = figlet.textSync("EMORA", { font: "ANSI Shadow" });
  logo.split("\n").forEach((l, i) => {
    const colors = [
      chalk.hex("#58a6ff"), chalk.hex("#6aabff"),
      chalk.hex("#7db0f7"), chalk.hex("#9299f7"), chalk.hex("#a371f7"),
    ];
    if (l.trim()) console.log(colors[i % colors.length].bold(l));
  });

  console.log();
  console.log(
    boxen(
      chalk.hex("#e6edf3")("Autonomous AI Agent — self-hosted, multi-platform, multi-provider") + "\n" +
      chalk.hex("#6e7681")("Panduan lengkap: skill/guide-emora/skill.md  •  atau tanya EMORA: \"jelasin cara pakai kamu\""),
      { padding: { left: 2, right: 2, top: 0, bottom: 0 }, borderStyle: "round", borderColor: "#58a6ff", margin: { left: 2 } }
    )
  );
  console.log();
}

// ─────────────────────────────────────────────
// SECTION: AI PROVIDER
// ─────────────────────────────────────────────
async function setupModel() {
  const { cmdModel } = await import("./cli/cmd-model.js");
  await cmdModel();
}

// ─────────────────────────────────────────────
// SECTION: GATEWAY (delegasi ke cli/cmd-gateway.js)
// ─────────────────────────────────────────────
async function setupGateway() {
  sectionHeader("MESSAGING GATEWAY", "Hubungkan EMORA ke Telegram / WhatsApp / Discord / Slack / Matrix");
  infoLine("Catatan", "wizard ini memanggil 'emora gateway setup' langsung, jadi hasilnya konsisten dengan menjalankan itu manual kapan pun", "cyan");
  console.log(C.line);

  let addMore = true;
  while (addMore) {
    // Delegasikan ke cli/cmd-gateway.js — dulu bagian ini reimplementasi
    // terpisah yang cuma nulis ke .env dan TIDAK PERNAH bisa mengonfigurasi
    // Slack/Matrix (yang butuh field kredensial di luar skema .env lama).
    // Sekarang cuma ada SATU sumber logika.
    const { cmdGateway } = await import("./cli/cmd-gateway.js");
    await cmdGateway(["setup"]);

    addMore = await confirm("Setup platform gateway lain juga?", { default: false });
    console.log(C.line);
  }
  sectionFooter();
}

// ─────────────────────────────────────────────
// SECTION: OBSIDIAN (delegasi ke cli/cmd-obsidian.js)
// ─────────────────────────────────────────────
async function setupObsidian() {
  sectionHeader("OBSIDIAN", "Hubungkan EMORA ke vault Obsidian lewat MCP");
  infoLine("Prasyarat", "Plugin community \"Local REST API\" aktif di Obsidian, dan Obsidian sedang terbuka", "cyan");
  const proceed = await confirm("Setup koneksi Obsidian sekarang?", { default: false });
  if (!proceed) {
    infoLine("Dilewati", "jalankan 'emora obsidian setup' kapan saja kalau berubah pikiran");
    sectionFooter();
    return;
  }
  const { cmdObsidian } = await import("./cli/cmd-obsidian.js");
  await cmdObsidian(["setup"]);
}

// ─────────────────────────────────────────────
// SECTION: MCP SERVERS (delegasi ke cli/cmd-mcp.js, sudah punya menu sendiri)
// ─────────────────────────────────────────────
async function setupMcpServers() {
  sectionHeader("MCP SERVERS", "Sambungkan EMORA ke tool eksternal lewat Model Context Protocol");
  infoLine("Contoh pemakaian", "GitHub, filesystem, database, atau server MCP custom kamu sendiri", "cyan");
  infoLine("Khusus Obsidian", "pakai menu \"Obsidian (via MCP)\" tersendiri — lebih terpandu", "cyan");
  console.log(C.line);
  const { cmdMcp } = await import("./cli/cmd-mcp.js");
  await cmdMcp([]); // interactive menu, punya "Keluar" sendiri
}

// ─────────────────────────────────────────────
// SECTION: PLUGIN MANAGER
// ─────────────────────────────────────────────
async function setupPlugins() {
  const pluginManager = (await import("./core/pluginManager.js")).default;
  const pluginHooks   = (await import("./core/pluginHooks.js")).default;

  let running = true;
  while (running) {
    await pluginManager.loadAllPlugins(); // scan ulang dari disk tiap kali (lihat catatan di cli/cmd-plugin.js)
    const plugins = pluginManager.listPlugins();
    const hooksAvailable = pluginHooks.listPluginsWithHooks();

    sectionHeader("PLUGIN MANAGER", `${plugins.length} plugin terpasang  •  ${hooksAvailable.length} punya hooks`);
    if (plugins.length) {
      for (const p of plugins) {
        const trusted = hooksAvailable.includes(p.id) ? (pluginHooks.isHooksTrusted(p.id) ? " [hooks: trusted]" : " [hooks: BELUM di-trust]") : "";
        infoLine(p.id, `${p.skillCount} skill, ${p.commandCount} command, ${p.toolCount} tool${trusted}`, trusted.includes("BELUM") ? "yellow" : "cyan");
      }
    } else {
      warnLine("Belum ada plugin terpasang.");
    }
    console.log(C.line);

    const action = await select("Pilih aksi:", [
      { label: "➕  Install plugin baru (URL GitHub / path lokal)", value: "install" },
      { label: "🔓  Trust hooks plugin",                            value: "trust", disabled: !hooksAvailable.length },
      { label: "🔒  Untrust hooks plugin",                          value: "untrust", disabled: !hooksAvailable.length },
      { label: "🔄  Reload plugin (habis edit kode-nya)",           value: "reload", disabled: !plugins.length },
      { label: "←   Kembali",                                       value: "back" },
    ]);

    if (action === "back") { running = false; break; }

    if (action === "install") {
      const source = await input("URL GitHub atau path lokal:");
      if (source) {
        try {
          const isGit = pluginManager.looksLikeGitUrl(source);
          const result = isGit ? await pluginManager.installPluginFromGit(source) : await pluginManager.installPluginFromPath(source);
          successLine(`Plugin "${result.id}" terinstall (${result.skillCount} skill, ${result.commandCount} command, ${result.toolCount} tool).`);
          if (result.hasHooks) {
            warnLine(`Plugin ini punya hooks (jalan otomatis tiap sesi/prompt) — pakai menu "Trust hooks plugin" buat mengaktifkannya.`);
          }
        } catch (err) {
          errorLine(`Gagal install: ${err.message}`);
        }
      }
    } else if (action === "trust") {
      const id = await select("Trust hooks plugin mana?", hooksAvailable.map((id) => ({ label: id, value: id })));
      pluginHooks.trustHooks(id);
      successLine(`Hooks "${id}" di-trust.`);
    } else if (action === "untrust") {
      const id = await select("Untrust hooks plugin mana?", hooksAvailable.map((id) => ({ label: id, value: id })));
      pluginHooks.untrustHooks(id);
      successLine(`Hooks "${id}" di-untrust.`);
    } else if (action === "reload") {
      const id = await select("Reload plugin mana?", plugins.map((p) => ({ label: p.id, value: p.id })));
      try {
        await pluginManager.reloadPlugin(id);
        successLine(`Plugin "${id}" berhasil di-reload.`);
      } catch (err) {
        errorLine(`Gagal reload: ${err.message}`);
      }
    }
    console.log(C.line);
  }
  sectionFooter();
}

// ─────────────────────────────────────────────
// SECTION: ADVANCED BEHAVIOR
// ─────────────────────────────────────────────
async function setupAdvancedBehavior() {
  sectionHeader("ADVANCED BEHAVIOR", "Nilai default perilaku agent — bisa diganti kapan saja per-sesi lewat /mode, /agentmode, /stream");

  const mode = await select("Mode approval default:", [
    { label: "Autonomous — jalankan tool tanpa nanya dulu (direkomendasikan)", value: "autonomous" },
    { label: "Safe — minta konfirmasi sebelum tiap tool dijalankan",           value: "safe" },
  ], { default: getEnv("DEFAULT_MODE") === "safe" ? 1 : 0 });
  setEnv("DEFAULT_MODE", mode);

  const agentModeOptions = [
    { label: "Chat — natural, gaya obrolan biasa",              value: "chat" },
    { label: "Simple — jawaban singkat & langsung ke poin",     value: "simple" },
    { label: "Planned — susun rencana dulu sebelum eksekusi",   value: "planned" },
    { label: "Deep — analisis mendalam, cocok tugas kompleks",  value: "deep" },
  ];
  const currentAgentMode = getEnv("DEFAULT_AGENTMODE") || "chat";
  const agentMode = await select("Gaya respons default:", agentModeOptions, {
    default: Math.max(0, agentModeOptions.findIndex((o) => o.value === currentAgentMode)),
  });
  setEnv("DEFAULT_AGENTMODE", agentMode);

  const stream = await confirm("Aktifkan efek ketik (streaming) secara default?", { default: getEnv("DEFAULT_STREAM") === "true" });
  setEnv("DEFAULT_STREAM", stream ? "true" : "false");

  // ── Context window ────────────────────────────────────────────────────
  sectionHeader("CONTEXT WINDOW", "Berapa banyak riwayat percakapan yang dikirim ke model tiap turn");
  const ctxPresets = [
    { label: "Kecil    — 8 pesan   · hemat token, model kecil (0.5–1B)", value: "8" },
    { label: "Normal   — 24 pesan  · seimbang (direkomendasikan)",     value: "24" },
    { label: "Besar    — 48 pesan  · sesi panjang, konteks luas",        value: "48" },
    { label: "Maksimal — 100 pesan · butuh model context besar",         value: "100" },
    { label: "Ketik manual...",                                    value: "__manual__" },
  ];
  const curCtx = getEnv("MAX_CONTEXT_MESSAGES") || "24";
  const ctxChoice = await select("Ukuran context window:", ctxPresets, {
    default: Math.max(0, ctxPresets.findIndex((p) => p.value === curCtx)),
  });
  let ctxVal = ctxChoice;
  if (ctxChoice === "__manual__") {
    ctxVal = await input("Jumlah pesan (angka):", "24");
  }
  const ctxNum = Math.max(2, Math.min(500, parseInt(ctxVal, 10) || 24));
  setEnv("MAX_CONTEXT_MESSAGES", String(ctxNum));

  // Link budget (chars) — guard prompt membengkak, selaras dengan ctx.
  const curBudget = getEnv("LINK_BUDGET") || "200000";
  const budget = await input("Link budget karakter (default 200000):", curBudget);
  setEnv("LINK_BUDGET", String(Math.max(10000, parseInt(budget, 10) || 200000)));

  successLine(`Default tersimpan: mode=${mode}, agentmode=${agentMode}, stream=${stream ? "on" : "off"}, ctx=${ctxNum} pesan`);
  infoLine("Berlaku mulai", "sesi TUI berikutnya (sesi yang sedang berjalan tidak berubah)", "cyan");
  sectionFooter();
}

// ─────────────────────────────────────────────
// SECTION: SECURITY & PRIVACY
// ─────────────────────────────────────────────
async function setupSecurity() {
  sectionHeader("SECURITY & PRIVACY", "Kunci EMORA dengan seedphrase untuk melindungi privasi sesi.");
  
  const currentHash = getEnv("SEED_HASH");
  if (currentHash) {
    infoLine("Status", "EMORA saat ini TERKUNCI oleh seedphrase.", "yellow");
    const remove = await confirm("Hapus kunci (unlock) EMORA?", { default: false });
    if (remove) {
      setEnv("SEED_HASH", "");
      successLine("Kunci EMORA berhasil dihapus.");
    }
    
    if (fs.existsSync("./memory_backup.enc")) {
       const doRestore = await confirm("Ditemukan backup terenkripsi. Pulihkan sesi sekarang?", { default: false });
       if (doRestore) {
         const { restoreMemory } = await import("./core/security.js");
         const sp = await input("Masukkan seedphrase lama untuk memulihkan: ", "", true);
         const ok = await restoreMemory(sp);
         if (ok) successLine("Sesi berhasil dipulihkan!");
         else errorLine("Seedphrase salah. Gagal memulihkan.");
       }
    }
  } else {
    infoLine("Status", "EMORA saat ini TIDAK TERKUNCI.", "green");
    const set = await confirm("Setel seedphrase untuk mengunci EMORA?", { default: true });
    if (set) {
      console.log(chalk.yellow("Masukkan seedphrase. Bebas, bisa 12 kata, PIN, atau password."));
      console.log(chalk.yellow("JIKA ANDA LUPA SEEDPHRASE, SESI TIDAK BISA DIPULIHKAN JIKA TERHAPUS!"));
      const seed1 = await input("Seedphrase: ", "", true);
      const seed2 = await input("Konfirmasi seedphrase: ", "", true);
      
      if (seed1 && seed1 === seed2) {
         const crypto = await import("crypto");
         const hash = crypto.createHash("sha256").update(seed1.trim()).digest("hex");
         setEnv("SEED_HASH", hash);
         successLine("EMORA berhasil dikunci. Seedphrase aman tersimpan sebagai hash.");
      } else {
         errorLine("Seedphrase tidak cocok atau kosong. Dibatalkan.");
      }
    }
  }
  sectionFooter();
}

// ─────────────────────────────────────────────
// SECTION: TOOLSET MANAGER (Aktifkan / Nonaktifkan Tool)
// ─────────────────────────────────────────────
async function setupToolset() {
  const ts = await import("./utils/toolsets.js");
  const presets = Object.keys(ts.PRESETS);

  let running = true;
  while (running) {
    const activeGroups = await ts.getActiveGroups();
    sectionHeader("TOOLSET MANAGER", `Grup Aktif: ${activeGroups.join(", ")}`);
    infoLine("Fungsi Toolset", "membatasi / memilih daftar tool yang dapat dipanggil agen untuk menghemat token", "cyan");
    console.log(C.line);

    const action = await select("Pilih opsi pengaturan toolset:", [
      { label: "📦  Pilih Preset Toolset (coding, chat, full, minimal)", value: "preset" },
      { label: "⚙️   Aktifkan / Nonaktifkan Grup Tool Spesifik",         value: "toggle_group" },
      { label: "←   Kembali ke Menu utama",                           value: "back" },
    ]);

    if (action === "back") {
      running = false;
      break;
    }

    if (action === "preset") {
      const presetChoices = presets.map((p) => ({
        label: `${p.padEnd(12)} — grup: ${ts.PRESETS[p].join(", ")}`,
        value: p,
      }));
      const chosen = await select("Pilih Preset Toolset:", presetChoices);
      await ts.applyPreset(chosen);
      const { reloadToolset } = await import("./core/tools.js");
      const n = await reloadToolset();
      successLine(`Preset "${chosen}" berhasil diterapkan (${n} tools live).`);
    } else if (action === "toggle_group") {
      const ALL_GROUPS = Object.keys(ts.TOOL_GROUPS);
      const choices = ALL_GROUPS.map((g) => {
        const active = activeGroups.includes(g);
        const count = (ts.TOOL_GROUPS[g] || []).length;
        return {
          label: `${active ? "🟢 [AKTIF]   " : "🔴 [NONAKTIF]"} ${g.padEnd(12)} (${count} tools)`,
          value: g,
        };
      });
      const groupToToggle = await select("Pilih grup tool untuk di-toggle:", choices);
      const isCurrentlyActive = activeGroups.includes(groupToToggle);
      const nextGroups = isCurrentlyActive
        ? activeGroups.filter((g) => g !== groupToToggle)
        : [...new Set([...activeGroups, groupToToggle])];

      await ts.setGroups(nextGroups);
      const { reloadToolset } = await import("./core/tools.js");
      const n = await reloadToolset();
      successLine(`Grup "${groupToToggle}" sekarang ${isCurrentlyActive ? "NONAKTIF" : "AKTIF"} (${n} tools live).`);
    }
    console.log(C.line);
  }
  sectionFooter();
}

// ─────────────────────────────────────────────
// SECTION: WEB UI
// ─────────────────────────────────────────────
async function setupWebUI() {
  sectionHeader("WEB UI", "Panel kontrol berbasis browser untuk EMORA");

  const enable = await confirm("Aktifkan Web UI?", { default: false });
  setEnv("WEBUI", enable ? "true" : "false");

  if (enable) {
    const port = await input("Port Web UI:", getEnv("WEBUI_PORT") || "5090");
    setEnv("WEBUI_PORT", port);
    successLine(`Web UI diaktifkan di port ${port}`);
    infoLine("Jalankan dengan", "emora --web", "cyan");
  } else {
    successLine("Web UI dinonaktifkan");
  }
  sectionFooter();
}

// ─────────────────────────────────────────────
// SECTION: NAMA & IDENTITAS
// ─────────────────────────────────────────────
async function setupName() {
  sectionHeader("IDENTITAS AGENT", "Nama yang dipakai EMORA saat mengobrol");
  const name = await input("Nama agent:", getEnv("NAME") || "Emora");
  setEnv("NAME", name);
  successLine(`Nama agent: ${name}`);
  sectionFooter();
}

// ─────────────────────────────────────────────
// SECTION: EMORA RECORDS (Encrypted Vault)
// ─────────────────────────────────────────────
async function setupRecordsVault() {
  const { isVaultInitialized, setMasterPassword } = await import("./core/recordsManager.js");
  sectionHeader("EMORA RECORDS VAULT", "Merekam kepribadian pengguna ke dalam vault terenkripsi (AES-256-GCM)");

  if (isVaultInitialized()) {
    infoLine("Status Vault", "Vault terenkripsi sudah aktif", "green");
    const change = await confirm("Mau ubah/set ulang Password Vault Master?", { default: false });
    if (!change) { sectionFooter(); return; }
  }

  warnLine("Password vault ini digunakan untuk mengamankan 7 dimensi kepribadian Anda.");
  const pwd = await input("Masukkan Password Vault Master (min 4 karakter):", "", true);
  if (!pwd || pwd.length < 4) {
    errorLine("Password vault minimal 4 karakter. Setup ditunda.");
    sectionFooter();
    return;
  }
  const pwdConfirm = await input("Konfirmasi Password Vault Master:", "", true);
  if (pwd !== pwdConfirm) {
    errorLine("Password tidak cocok. Setup vault dibatalkan.");
    sectionFooter();
    return;
  }

  setMasterPassword(pwd);
  successLine("EMORA RECORDS Vault terenkripsi berhasil dikonfigurasi!");
  sectionFooter();
}

// ─────────────────────────────────────────────
// SECTION: REVIEW KONFIGURASI
// ─────────────────────────────────────────────
async function reviewConfig() {
  const { loadGatewayConfig } = await import("./gateway/config.js");
  const pluginManager = (await import("./core/pluginManager.js")).default;
  await pluginManager.loadAllPlugins();

  const gwCfg = loadGatewayConfig();
  const activePlatforms = Object.entries(gwCfg.platforms || {}).filter(([, p]) => p.enabled).map(([name]) => name);
  const plugins = pluginManager.listPlugins();

  let mcpServerCount = 0;
  try {
    const mcpCfg = JSON.parse(fs.readFileSync("./mcp/mcp.config.json", "utf8"));
    mcpServerCount = (mcpCfg.servers || []).length;
  } catch { /* belum ada config MCP */ }

  const rows = [
    ["Nama Agent",        getEnv("NAME") || "Emora"],
    ["Provider AI",       getEnv("MODEL_PROVIDER") || chalk.hex("#f85149")("belum diatur")],
    ["Model",             getEnv("MODEL_NAME") || "—"],
    ["Web Search (Tavily)", getEnv("TAVILY_API_KEY") ? "aktif" : "nonaktif"],
    ["Gateway aktif",     activePlatforms.length ? activePlatforms.join(", ") : "belum ada"],
    ["MCP Server",        `${mcpServerCount} server dikonfigurasi`],
    ["Plugin terpasang",  `${plugins.length} plugin`],
    ["Web UI",            getEnv("WEBUI") === "true" ? `aktif (port ${getEnv("WEBUI_PORT") || 5090})` : "nonaktif"],
    ["Mode default",      getEnv("DEFAULT_MODE") || "autonomous"],
    ["Gaya respons default", getEnv("DEFAULT_AGENTMODE") || "chat"],
  ];

  const labelWidth = Math.max(...rows.map(([l]) => l.length)) + 2;
  const bodyLines = rows.map(([l, v]) => chalk.hex("#8b949e")(l.padEnd(labelWidth)) + chalk.hex("#e6edf3")(v)).join("\n");

  console.log();
  console.log(boxen(bodyLines, {
    title: chalk.hex("#58a6ff").bold("Ringkasan Konfigurasi EMORA"),
    titleAlignment: "center",
    padding: 1,
    margin: { left: 2 },
    borderStyle: "round",
    borderColor: "#58a6ff",
  }));
  console.log();
  await input("Tekan Enter untuk kembali ke menu...");
}

// ─────────────────────────────────────────────
// QUICK SETUP (first-run) vs MENU LENGKAP
// ─────────────────────────────────────────────
async function runQuickSetup() {
  sectionHeader("PANDUAN CEPAT", "3 langkah minimal buat mulai pakai EMORA — sisanya bisa diatur belakangan lewat Menu Lengkap");
  infoLine("Langkah 1/3", "Pilih provider AI & model", "cyan");
  infoLine("Langkah 2/3", "Nama agent",                  "cyan");
  infoLine("Langkah 3/3", "(Opsional) hubungkan ke Telegram/WhatsApp/dst",  "cyan");
  sectionFooter();

  await setupModel();
  await setupName();

  const wantGateway = await confirm("Mau langsung hubungkan ke Telegram/WhatsApp/Discord/Slack/Matrix sekarang?", { default: false });
  if (wantGateway) await setupGateway();
}

function printFinalSummary() {
  console.clear();
  showSetupBanner();
  sectionHeader("SETUP SELESAI", "Konfigurasi berhasil disimpan");
  successLine("Jalankan EMORA (TUI interaktif):     emora");
  successLine("Start dengan gateway (background):   emora gateway run");
  successLine("Cek status semua komponen:           emora status");
  console.log(C.line);
  infoLine("Kelola skill", "emora skills   (atau '/skills' di dalam TUI)", "cyan");
  infoLine("Kelola plugin", "emora plugin list | install <url> | trust-hooks <id>", "cyan");
  infoLine("Kelola MCP server", "emora mcp", "cyan");
  infoLine("Setup Obsidian nanti", "emora obsidian setup", "cyan");
  infoLine("Panduan lengkap", "baca skill/guide-emora/skill.md, atau tanya EMORA langsung: \"jelasin cara pakai kamu\"", "cyan");
  sectionFooter();
}

// ─────────────────────────────────────────────
// CONTEXT FILES — kelola file yang membentuk setiap percakapan
// (AGENT.md = rules/protocols, SOUL.md = personality). Edit lewat
// $EDITOR, lalu invalidate system prompt cache supaya perubahan
// langsung berlaku tanpa restart (lihat core/chat.js).
// ─────────────────────────────────────────────
async function setupContextFiles() {
  const options = [
    { label: "✏️   Edit AGENT.md (Protokol Penuh)",          value: "AGENT.md" },
    { label: "⚡  Edit AGENT_LITE.md (Protokol Ringkas)",      value: "AGENT_LITE.md" },
    { label: "🔄  Pilih Mode Aktif (Auto | Lite | Full)",     value: "switch_mode" },
    { label: "📋  Ganti AGENT.md dengan AGENT_LITE.md",      value: "copy_lite" },
    { label: "📋  Ganti AGENT_LITE.md dengan AGENT.md",      value: "copy_full" },
    { label: "🎭  Edit SOUL.md (Kepribadian Agent)",          value: "SOUL.md" },
    { label: "↩️   Kembali ke menu utama",                    value: "__back" },
  ];

  let running = true;
  while (running) {
    sectionHeader("CONTEXT FILES", "File yang disuntik ke system prompt di SETIAP turn");
    for (const f of ["AGENT.md", "AGENT_LITE.md", "SOUL.md"]) {
      const lines = fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").length : 0;
      infoLine(f, `${lines} baris`, lines > 0 ? "green" : "yellow");
    }
    const currentMode = getEnv("AGENT_MODE") || "auto (otomatis pilih berdasarkan ukuran model)";
    infoLine("AGENT_MODE aktif", currentMode, "cyan");
    console.log(C.line);

    const pick = await select("Pilih opsi pengelolaan:", options);
    if (pick === "__back") { running = false; break; }

    if (pick === "switch_mode") {
      const mode = await select("Pilih mode AGENT_MODE:", [
        { label: "Auto  - Otomatis pilih LITE untuk model kecil/8b, FULL untuk model besar", value: "auto" },
        { label: "Lite  - Paksa selalu gunakan AGENT_LITE.md (Hemat Token)",                   value: "lite" },
        { label: "Full  - Paksa selalu gunakan AGENT.md (Protokol Penuh)",                     value: "full" },
      ]);
      setEnv("AGENT_MODE", mode);
      try {
        const { invalidateSystemPromptCache } = await import("./core/chat.js");
        invalidateSystemPromptCache();
      } catch {}
      successLine(`AGENT_MODE diset ke "${mode}". System prompt di-refresh.`);
      continue;
    }

    if (pick === "copy_lite") {
      if (fs.existsSync("AGENT_LITE.md")) {
        fs.copyFileSync("AGENT_LITE.md", "AGENT.md");
        try {
          const { invalidateSystemPromptCache } = await import("./core/chat.js");
          invalidateSystemPromptCache();
        } catch {}
        successLine("Isi AGENT_LITE.md berhasil disalin menggantikan AGENT.md!");
      } else {
        warnLine("Berkas AGENT_LITE.md tidak ditemukan di direktori root.");
      }
      continue;
    }

    if (pick === "copy_full") {
      if (fs.existsSync("AGENT.md")) {
        fs.copyFileSync("AGENT.md", "AGENT_LITE.md");
        try {
          const { invalidateSystemPromptCache } = await import("./core/chat.js");
          invalidateSystemPromptCache();
        } catch {}
        successLine("Isi AGENT.md berhasil disalin menggantikan AGENT_LITE.md!");
      } else {
        warnLine("Berkas AGENT.md tidak ditemukan di direktori root.");
      }
      continue;
    }

    const editor = process.env.EDITOR || process.env.VISUAL || "vi";
    const { spawnSync } = await import("child_process");
    const r = spawnSync(editor, [pick], { stdio: "inherit" });
    if (r.status !== 0) {
      warnLine(`Editor "${editor}" keluar dengan error. Set EDITOR env kalau mau editor lain.`);
      continue;
    }

    // Invalidate cache prompt agar edit langsung berefek.
    try {
      const { invalidateSystemPromptCache } = await import("./core/chat.js");
      invalidateSystemPromptCache();
      successLine(`${pick} tersimpan — system prompt sudah di-refresh (berlaku turn berikutnya).`);
    } catch {
      successLine(`${pick} tersimpan. Restart EMORA agar perubahan pasti berlaku.`);
    }
  }
}

// ─────────────────────────────────────────────
// ARCHITECTURE — peta sistem untuk operator:
// agent loop, jumlah tool aktif, toolset, backends.
// Read-only; sumber data = filesystem + import dinamis.
// ─────────────────────────────────────────────
async function showArchitecture() {
  console.clear();
  showSetupBanner();
  sectionHeader("ARCHITECTURE", "Struktur internal EMORA");

  const dim = chalk.hex("#8b949e");

  // Agent loop
  console.log(chalk.hex("#a371f7").bold("  AGENT LOOP"));
  console.log(dim("    user input → core/chat.js ask() → LLM → tool_calls"));
  console.log(dim("    → approval gate (mode: autonomous|safe|plan) → executeTool"));
  console.log(dim("    → hasil kembali ke LLM → loop sampai jawaban final → saveSession"));
  console.log();

  // Toolset: hitung real dari registry
  let toolCount = "?";
  try {
    const toolsMod = await import("./core/tools.js");
    toolCount = toolsMod.default.length;
  } catch {}
  console.log(chalk.hex("#a371f7").bold(`  TOOLSET (${toolCount} tools aktif)`));
  try {
    const toolsMod = await import("./core/tools.js");
    const names = toolsMod.default.map((t) => t.name);
    const perLine = 4;
    for (let i = 0; i < names.length; i += perLine) {
      console.log(dim("    " + names.slice(i, i + perLine).join(", ")));
    }
  } catch { console.log(dim("    (gagal memuat daftar tool)")); }
  console.log();

  // Skills & plugins
  let skillCount = 0, pluginCount = 0;
  try {
    const reg = await import("./core/skillRegistry.js");
    skillCount = (await reg.default.listAll()).length;
  } catch {}
  try {
    pluginCount = fs.readdirSync("./plugins", { withFileTypes: true }).filter(e => e.isDirectory()).length;
  } catch {}
  console.log(chalk.hex("#a371f7").bold("  CAPABILITIES"));
  console.log(dim(`    skills+commands terdaftar : ${skillCount} (core/skillRegistry.js)`));
  console.log(dim(`    plugins terpasang         : ${pluginCount} (plugins/, format Claude Code)`));
  console.log();

  // Backends / entrypoints
  console.log(chalk.hex("#a371f7").bold("  BACKENDS (entrypoint)"));
  console.log(dim("    TUI        tui/index.js          — terminal interaktif"));
  console.log(dim("    Gateway    gateway/manager.js    — Telegram/WhatsApp/Discord/Slack/Matrix"));
  console.log(dim("    Web UI     webui/server.js       — dashboard browser (SSE)"));
  console.log(dim("    CLI one-shot bin/emora.js run \"<prompt>\" — chat sekali jalan"));
  console.log();

  // Memory & storage
  console.log(chalk.hex("#a371f7").bold("  MEMORY & STORAGE"));
  console.log(dim("    memory/           sesi percakapan (core/memoryDB.js)"));
  console.log(dim("    library/          knowledge base RAG TF-IDF (tools/knowledge_library.js)"));
  console.log(dim("    .emora/undo/      snapshot undo/redo (tools/undo.js)"));
  console.log(dim("    .emora/mode.json  mode operasi (tools/change_mode.js)"));

  sectionFooter();
  await input("Tekan Enter untuk kembali ke menu...");
}

// ─────────────────────────────────────────────
// SKILLS HUB — procedural memory terpusat: lihat skill terpasang,
// buat skill baru (manual / dari sesi), install dari community.
// ─────────────────────────────────────────────
async function setupSkillsHub() {
  let running = true;
  while (running) {
    sectionHeader("SKILLS HUB", "Procedural memory — skill yang bisa dipanggil /<nama>");

    // Statistik real.
    let builtin = 0, plugin = 0;
    try {
      const reg = await import("./core/skillRegistry.js");
      const all = await reg.default.listAll();
      builtin = all.filter(s => s.source === "builtin").length;
      plugin  = all.filter(s => s.pluginId).length;
    } catch {}
    infoLine("Skill bawaan", `${builtin} di ./skill/`, "green");
    infoLine("Dari plugin", `${plugin} di ./plugins/`, plugin ? "green" : "dim");
    console.log(C.line);

    const action = await select("Pilih aksi:", [
      { label: "📋  Lihat semua skill",                    value: "list" },
      { label: "✨  Buat skill baru (wizard)",              value: "create" },
      { label: "📥  Install dari EMORA Hub (@user/nama)",   value: "install" },
      { label: "📖  Baca panduan menulis skill",            value: "guide" },
      { label: "↩️   Kembali ke menu utama",                value: "__back" },
    ]);

    if (action === "__back") { running = false; break; }

    if (action === "list") {
      try {
        const reg = await import("./core/skillRegistry.js");
        const all = await reg.default.listAll();
        for (const s of all) {
          console.log(`  ${chalk.hex("#58a6ff").bold(("/" + s.slashName).padEnd(34))} ${chalk.hex("#8b949e")((s.description || "").slice(0, 55))}`);
        }
      } catch (e) { warnLine(`Gagal memuat katalog: ${e.message}`); }
      console.log();
      await input("Tekan Enter...");
    }

    if (action === "create") {
      const name = await input("Nama skill (huruf kecil, underscore): ");
      const safe = (name || "").toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
      if (!safe) { warnLine("Nama tidak valid."); continue; }
      const desc = await input("Deskripsi singkat (untuk katalog): ");
      const dir = `skill/${safe}`;
      if (fs.existsSync(dir)) { warnLine(`Skill "${safe}" sudah ada.`); continue; }
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "skill.md"),
`---
name: ${safe}
description: ${desc || "(belum ada deskripsi)"}
categories:
---

# ${safe}

(Tulis instruksi langkah demi langkah di sini — agent akan mengikutinya saat skill ini dipanggil.)
`);
      fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({
        name: safe, description: desc || "", version: "1.0.0", has_script: false,
      }, null, 2));
      successLine(`Skill "${safe}" dibuat. Edit isi di ${dir}/skill.md — langsung terbaca tanpa restart.`);
    }

    if (action === "install") {
      const name = await input("Nama (@user/nama atau nama): ");
      if (!name) continue;
      try {
        const { installSkill } = await import("./cli/cmd-community.js");
        await installSkill(name.trim());
      } catch (e) { warnLine(`Install gagal: ${e.message}`); }
    }

    if (action === "guide") {
      const { spawnSync } = await import("child_process");
      const editor = process.env.EDITOR || "vi";
      spawnSync(editor, ["skill/SKILL.md"], { stdio: "inherit" });
    }
  }
}

// ─────────────────────────────────────────────
// MAIN MENU
// ─────────────────────────────────────────────
export async function runSetup() {
  showSetupBanner();

  for (const dir of ["./uploads", "./downloads", "./memory", "./backups", "./plugins", "./library"]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // Config.yml is automatically managed via core/config.js.

  // Langkah 0: User milih alur setup (Step-by-Step Berurutan vs Menu Manual)
  const setupMode = await select("Pilih metode setup EMORA:", [
    { label: "🚀  Step-by-Step (Panduan 5 Langkah Berurutan)", value: "stepByStep" },
    { label: "📋  Menu Manual (Akses semua opsi dari menu)",     value: "manual" },
  ]);

  if (setupMode === "stepByStep") {
    sectionHeader("LANGKAH 1/5", "Setup AI Provider & Model Utama");
    await setupModel();

    sectionHeader("LANGKAH 2/5", "Mode Keamanan & Approval Agent");
    await setupAdvancedBehavior();

    sectionHeader("LANGKAH 3/5", "Preset Toolset Manager");
    await setupToolset();

    sectionHeader("LANGKAH 4/5", "Identitas & Nama Agent");
    await setupName();

    sectionHeader("LANGKAH 5/5", "Messaging Gateway / Integrasi");
    await setupGateway();

    printFinalSummary();
    process.exit(0);
  }

  let running = true;

  while (running) {
    const { loadGatewayConfig } = await import("./gateway/config.js");
    const gwCfg = loadGatewayConfig();
    const model    = getEnv("MODEL_NAME") || "belum diatur";
    const provider = getEnv("MODEL_PROVIDER") || "belum diatur";
    const activePlatforms = Object.entries(gwCfg.platforms || {}).filter(([, p]) => p.enabled).map(([name]) => name);

    let mcpServerCount = 0;
    try {
      const mcpCfg = JSON.parse(fs.readFileSync("./mcp/mcp.config.json", "utf8"));
      mcpServerCount = (mcpCfg.servers || []).length;
    } catch { /* belum ada */ }

    let pluginCount = 0;
    try {
      pluginCount = fs.readdirSync("./plugins", { withFileTypes: true }).filter((e) => e.isDirectory()).length;
    } catch { /* belum ada */ }

    sectionHeader("SETUP MENU", `Provider: ${provider}  •  Model: ${model}`);
    infoLine("Gateway aktif", activePlatforms.length ? activePlatforms.join(", ") : "belum ada", activePlatforms.length ? "green" : "yellow");
    console.log(C.line);

    const choice = await select("Apa yang ingin dikonfigurasi?", [
      { label: "🤖  AI Provider & Model",        value: "provider", hint: provider },
      { label: "📡  Messaging Gateway",          value: "gateway",  hint: activePlatforms.length ? `${activePlatforms.length} aktif` : "belum ada" },
      { label: "🗒️   Obsidian (via MCP)",         value: "obsidian" },
      { label: "🔌  MCP Servers",                value: "mcp",      hint: `${mcpServerCount} server` },
      { label: "🧩  Plugin Manager",             value: "plugins",  hint: `${pluginCount} terpasang` },
      { label: "🧰  Toolset Manager (Aktifkan/Nonaktifkan Tool)", value: "toolset", hint: "kelola grup tool" },
      { label: "⚙️   Advanced Behavior",          value: "advanced", hint: getEnv("DEFAULT_MODE") || "autonomous" },
      { label: "🌐  Web UI",                     value: "webui",    hint: getEnv("WEBUI") === "true" ? "aktif" : "nonaktif" },
      { label: "✏️   Nama & Identitas Agent",     value: "name",     hint: getEnv("NAME") || "Emora" },
      { label: "🔒  Security & Privacy (App Lock)",value: "security", hint: getEnv("SEED_HASH") ? "locked" : "unlocked" },
      { label: "🔐  EMORA RECORDS Vault",        value: "records",  hint: "kepribadian terenkripsi" },
      { label: "📄  Context Files (AGENT.md/SOUL.md)", value: "context", hint: "shape setiap percakapan" },
      { label: "🏗️   Architecture",               value: "arch"     },
      { label: "🧠  Skills Hub",                   value: "skillsHub", hint: "procedural memory" },
      { label: "📋  Review Semua Konfigurasi",   value: "review"   },
      { label: "🚀  Selesai & Keluar",           value: "exit"     },
    ]);

    switch (choice) {
      case "provider": await setupModel();            break;
      case "gateway":  await setupGateway();           break;
      case "obsidian": await setupObsidian();           break;
      case "mcp":      await setupMcpServers();         break;
      case "plugins":  await setupPlugins();            break;
      case "toolset":  await setupToolset();            break;
      case "advanced": await setupAdvancedBehavior();  break;
      case "webui":    await setupWebUI();              break;
      case "name":     await setupName();               break;
      case "records":  await setupRecordsVault();        break;
      case "security": await setupSecurity();            break;
      case "context":  await setupContextFiles();       break;
      case "arch":     await showArchitecture();        break;
      case "skillsHub": await setupSkillsHub();         break;
      case "review":   await reviewConfig();            break;
      case "exit":
        running = false;
        printFinalSummary();
        process.exit(0);
        break;
    }

    if (running) showSetupBanner();
  }
}

if (process.argv[1] && process.argv[1].endsWith("setup.js")) {
  runSetup().catch((err) => {
    console.error(chalk.hex("#f85149")(`\n[SETUP ERROR] ${err.message}\n`));
    process.exit(1);
  });
}
