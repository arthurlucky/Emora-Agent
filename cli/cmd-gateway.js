/**
 * cli/cmd-gateway.js
 *
 * `emora gateway ...` — kontrol penuh gateway Telegram/WhatsApp/Discord:
 * status, start/stop, jalan sebagai daemon (`run`), setup interaktif,
 * kelola cron job, dan install/uninstall sebagai service OS.
 */
import chalk from "chalk";
import {
  sectionHeader, sectionFooter, infoLine, successLine, warnLine, errorLine,
  select, confirm, input,
} from "./select.js";
import { getManager } from "../gateway/manager.js";
import { loadGatewayConfig, saveGatewayConfig, setPlatformConfig } from "../gateway/config.js";
import { daemonStatus, writePID, removePID, stopDaemon, tryAcquireTUIGatewayLock } from "../gateway/daemon.js";
import { installService, uninstallService, serviceStatus, restartService } from "../gateway/service/index.js";

const cyan = chalk.hex("#58a6ff");
const dim = chalk.hex("#8b949e");
const green = chalk.hex("#3fb950");

function printStatusBlock(cfg, daemon) {
  sectionHeader("EMORA Gateway", "Status platform & daemon");
  infoLine("Daemon", daemon.running ? `berjalan (PID ${daemon.pid})` : "tidak berjalan");

  const platforms = Object.entries(cfg.platforms || {});
  if (!platforms.length) {
    infoLine("Platform", "belum ada yang dikonfigurasi — jalankan 'emora gateway setup'", "yellow");
  } else {
    for (const [name, p] of platforms) {
      infoLine(
        name,
        p.enabled ? "aktif di config" : "nonaktif",
        p.enabled ? "green" : "yellow"
      );
    }
  }
  console.log(cyan("  │"));
  console.log(dim("  │  Catatan: sesi/user yang sedang live cuma kelihatan dari proses yang"));
  console.log(dim("  │  menjalankannya (mis. 'emora gateway run' atau TUI lewat /gateway)."));
  sectionFooter();
}

async function cmdStatusAction() {
  const cfg = loadGatewayConfig();
  const daemon = daemonStatus();
  printStatusBlock(cfg, daemon);
}

async function cmdSetup() {
  sectionHeader("Setup Gateway", "Hubungkan EMORA ke Telegram/WhatsApp/Discord/Slack/Matrix");

  const platform = await select("Platform mana yang mau di-setup?", [
    { label: "Telegram", value: "telegram" },
    { label: "WhatsApp", value: "whatsapp" },
    { label: "Discord", value: "discord" },
    { label: "Slack", value: "slack" },
    { label: "Matrix", value: "matrix" },
  ]);

  const cfg = loadGatewayConfig();
  const existing = cfg.platforms[platform] || { allowedUsers: [], extra: {} };
  const patch = { type: platform, extra: { ...existing.extra } };

  if (platform === "telegram") {
    patch.token = await input("Bot token Telegram (@BotFather): ", existing.token || "", true);
    const ids = await input("Allowed chat ID (pisah koma, kosongkan = semua): ", (existing.allowedUsers || []).join(","));
    patch.allowedUsers = ids.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (platform === "whatsapp") {
    patch.extra.phoneNumber = await input("Nomor WhatsApp (mis. 62812xxxx): ", existing.extra?.phoneNumber || "");
    const nums = await input("Allowed numbers (pisah koma, kosongkan = semua): ", (existing.allowedUsers || []).join(","));
    patch.allowedUsers = nums.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (platform === "discord") {
    patch.token = await input("Bot token Discord: ", existing.token || "", true);
    patch.extra.guildId = await input("Guild ID (kosongkan = semua server bot ini diundang): ", existing.extra?.guildId || "");
    const ids = await input("Allowed user ID (pisah koma, kosongkan = semua): ", (existing.allowedUsers || []).join(","));
    patch.allowedUsers = ids.split(",").map((s) => s.trim()).filter(Boolean);
    const maxUsers = await input("Maksimal user aktif bersamaan (0 = tanpa batas): ", String(existing.maxUsers || 0));
    patch.maxUsers = Number(maxUsers) || 0;
  } else if (platform === "slack") {
    infoLine("Butuh 2 token", "dari https://api.slack.com/apps — aktifkan Socket Mode dulu", "cyan");
    infoLine("Bot Token", "OAuth & Permissions → Bot User OAuth Token (diawali xoxb-)", "cyan");
    infoLine("App Token", "Basic Information → App-Level Tokens, scope 'connections:write' (diawali xapp-)", "cyan");
    patch.botToken = await input("Bot Token (xoxb-...): ", existing.botToken || "", true);
    patch.appToken = await input("App-Level Token (xapp-...): ", existing.appToken || "", true);
    const ids = await input("Allowed user ID Slack (pisah koma, kosongkan = semua): ", (existing.allowedUsers || []).join(","));
    patch.allowedUsers = ids.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (platform === "matrix") {
    infoLine("Homeserver", "URL server Matrix kamu, mis. https://matrix.org", "cyan");
    infoLine("Access Token", "Element → Settings → Help & About → Advanced → Access Token", "cyan");
    patch.baseUrl = await input("Homeserver URL: ", existing.baseUrl || "https://matrix.org");
    patch.accessToken = await input("Access Token: ", existing.accessToken || "", true);
    patch.userId = await input("User ID (mis. @emorabot:matrix.org): ", existing.userId || "");
    const ids = await input("Allowed user/room ID (pisah koma, kosongkan = semua): ", (existing.allowedUsers || []).join(","));
    patch.allowedUsers = ids.split(",").map((s) => s.trim()).filter(Boolean);
  }

  patch.enabled = await confirm(`Aktifkan gateway ${platform} sekarang?`, { default: true });

  setPlatformConfig(platform, patch);
  successLine(`Konfigurasi ${platform} tersimpan.`);
  infoLine("Jalankan", patch.enabled ? "'emora gateway run' (atau start dari TUI)" : "'emora gateway setup' lagi kapan saja buat ubah");
  sectionFooter();
}

async function cmdStart(platform) {
  const mgr = getManager();
  const cfg = mgr.loadConfig();

  if (platform && !cfg.platforms[platform]) {
    errorLine(`Platform '${platform}' belum dikonfigurasi. Jalankan 'emora gateway setup' dulu.`);
    return;
  }

  if (platform) {
    cfg.platforms[platform].enabled = true;
    mgr.saveConfig(cfg);
  }

  if (!tryAcquireTUIGatewayLock()) {
    errorLine("Gateway sudah dijalankan proses lain (daemon atau TUI). Cek 'emora gateway status'.");
    return;
  }

  sectionHeader("EMORA Gateway", platform ? `Menjalankan '${platform}'...` : "Menjalankan semua platform aktif...");

  let results;
  if (platform) {
    try {
      await mgr.start(platform);
      results = { [platform]: { ok: true } };
      mgr.cronScheduler.start();
    } catch (err) {
      results = { [platform]: { ok: false, error: err.message } };
    }
  } else {
    results = await mgr.startAllEnabled();
  }

  for (const [name, r] of Object.entries(results)) {
    if (r.ok) successLine(`${name}: aktif`);
    else errorLine(`${name}: ${r.error}`);
  }

  if (!Object.values(results).some((r) => r.ok)) {
    warnLine("Gak ada gateway yang berhasil jalan. Proses dihentikan.");
    sectionFooter();
    return;
  }

  sectionFooter();
  console.log(dim("  Tekan Ctrl+C untuk berhenti.\n"));

  await blockUntilSignal(mgr);
}

async function cmdRun() {
  const mgr = getManager();

  if (!tryAcquireTUIGatewayLock()) {
    errorLine("Gateway sudah berjalan di proses lain.");
    process.exit(1);
  }

  writePID();
  sectionHeader("EMORA Gateway Daemon", "Menjalankan semua platform yang aktif di config...");

  const results = await mgr.startAllEnabled();
  for (const [name, r] of Object.entries(results)) {
    if (r.ok) successLine(`${name}: aktif`);
    else errorLine(`${name}: ${r.error}`);
  }
  sectionFooter();

  await blockUntilSignal(mgr, true);
}

function blockUntilSignal(mgr, isDaemon = false) {
  return new Promise((resolve) => {
    const shutdown = async (sig) => {
      console.log(dim(`\n  Menerima ${sig}, menghentikan gateway...`));
      await mgr.stopAll();
      if (isDaemon) removePID();
      resolve();
      process.exit(0);
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  });
}

async function cmdStop(platform) {
  if (platform) {
    const cfg = loadGatewayConfig();
    if (!cfg.platforms[platform]) {
      errorLine(`Platform '${platform}' tidak dikenal.`);
      return;
    }
    cfg.platforms[platform].enabled = false;
    saveGatewayConfig(cfg);
    successLine(`'${platform}' dinonaktifkan di config.`);
    warnLine("Kalau daemon lagi jalan, restart supaya perubahan berlaku ('emora gateway restart-service' atau Ctrl+C lalu 'emora gateway run' lagi).");
    return;
  }

  try {
    const pid = stopDaemon();
    successLine(`Daemon (PID ${pid}) dihentikan.`);
  } catch (err) {
    errorLine(err.message);
  }
}

async function cmdUsers() {
  const cfg = loadGatewayConfig();
  sectionHeader("Gateway Users", "Allowlist per platform (bukan sesi live)");
  for (const [name, p] of Object.entries(cfg.platforms || {})) {
    const list = p.allowedUsers?.length ? p.allowedUsers.join(", ") : "(semua diizinkan)";
    infoLine(name, list);
  }
  console.log(cyan("  │"));
  console.log(dim("  │  Buat lihat sesi yang lagi aktif live, cek '/gateway status' dari"));
  console.log(dim("  │  dalam TUI selagi gateway jalan di situ."));
  sectionFooter();
}

async function cmdCron(args) {
  const { CronStore } = await import("../gateway/cron/store.js");
  const store = new CronStore();
  const sub = (args[0] || "list").toLowerCase();

  sectionHeader("Cron Jobs", "Dikelola lintas platform (chat asal tetap dari Telegram/Discord/WhatsApp)");

  if (sub === "list") {
    const jobs = store.listJobs();
    if (!jobs.length) infoLine("Jobs", "belum ada. Buat lewat '/cron create' dari chat platform.", "yellow");
    for (const j of jobs) {
      infoLine(j.name, `${j.enabled ? "aktif" : "nonaktif"} · ${j.schedule} · "${j.prompt}"`, j.enabled ? "green" : "yellow");
    }
  } else if (sub === "enable" || sub === "disable") {
    const name = args[1];
    if (!name) { errorLine("Sebutkan nama job."); sectionFooter(); return; }
    try {
      const job = store.getJob(name);
      job.enabled = sub === "enable";
      store.saveJob(job);
      successLine(`'${name}' ${job.enabled ? "diaktifkan" : "dinonaktifkan"}.`);
    } catch (err) { errorLine(err.message); }
  } else if (sub === "delete") {
    const name = args[1];
    if (!name) { errorLine("Sebutkan nama job."); sectionFooter(); return; }
    try { store.deleteJob(name); successLine(`'${name}' dihapus.`); }
    catch (err) { errorLine(err.message); }
  } else {
    warnLine(`Sub-command '${sub}' tidak dikenal. Pakai: list | enable <n> | disable <n> | delete <n>`);
    infoLine("Buat job baru", "kirim '/cron create \"<jadwal>\" \"<prompt>\"' dari chat Telegram/Discord/WhatsApp");
  }
  sectionFooter();
}

async function cmdService(action) {
  sectionHeader("EMORA Gateway Service", `Platform: ${process.platform}`);
  try {
    if (action === "install") {
      const res = await installService();
      successLine("Service ter-install & dijalankan.");
      if (res?.path) infoLine("File", res.path);
      if (res?.note) infoLine("Catatan", res.note);
    } else if (action === "uninstall") {
      await uninstallService();
      successLine("Service dicopot.");
    } else if (action === "restart") {
      await restartService();
      successLine("Service di-restart.");
    } else {
      const st = await serviceStatus();
      infoLine("Terinstall", st.installed ? "ya" : "tidak");
      infoLine("Status", st.active ? "aktif" : "tidak aktif", st.active ? "green" : "yellow");
    }
  } catch (err) {
    errorLine(err.message);
  }
  sectionFooter();
}

export async function cmdGateway(args) {
  const sub = (args[0] || "status").toLowerCase();
  const rest = args.slice(1);

  switch (sub) {
    case "status": return cmdStatusAction();
    case "setup": return cmdSetup();
    case "start": return cmdStart(rest[0]);
    case "stop": return cmdStop(rest[0]);
    case "run": return cmdRun();
    case "users": return cmdUsers();
    case "cron": return cmdCron(rest);
    case "install-service": return cmdService("install");
    case "uninstall-service": return cmdService("uninstall");
    case "restart-service": return cmdService("restart");
    case "service-status": return cmdService("status");
    default:
      errorLine(`Sub-command '${sub}' tidak dikenal.`);
      console.log(dim("  Pakai: status | setup | start [platform] | stop [platform] | run | users | cron | install-service | uninstall-service | service-status | restart-service"));
  }
}
