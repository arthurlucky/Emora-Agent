/**
 * cli/cmd-gateway.js — `emora gateway`
 * Jalankan gateway (Telegram/WhatsApp) tanpa CLI loop.
 * Berguna buat server/VPS yang hanya butuh gateway messaging.
 */

import "dotenv/config";
import chalk from "chalk";
import { sectionHeader, sectionFooter, infoLine, successLine, warnLine, errorLine } from "./select.js";

const C = {
  green:  (t) => chalk.hex("#3fb950")(t),
  red:    (t) => chalk.hex("#f85149")(t),
  yellow: (t) => chalk.hex("#d29922")(t),
  cyan:   (t) => chalk.hex("#58a6ff")(t),
  muted:  (t) => chalk.hex("#8b949e")(t),
};

export async function cmdGateway() {
  sectionHeader("GATEWAY MODE", "Menjalankan gateway tanpa CLI agent loop");

  const tgEnabled = process.env.TELEGRAM_GATEWAY === "true" && process.env.TELEGRAM_TOKEN_BOT;
  const waEnabled = process.env.WA_GATEWAY === "true" && process.env.WA_PHONE_NUMBER;

  if (!tgEnabled && !waEnabled) {
    errorLine("Tidak ada gateway yang dikonfigurasi.");
    console.log();
    console.log(C.muted("  Jalankan  ") + C.cyan("emora setup") + C.muted("  untuk mengkonfigurasi gateway."));
    sectionFooter();
    process.exit(1);
  }

  infoLine("Telegram", tgEnabled ? "✓ Akan diaktifkan" : "○ Nonaktif", tgEnabled ? "green" : "yellow");
  infoLine("WhatsApp", waEnabled ? "✓ Akan diaktifkan" : "○ Nonaktif", waEnabled ? "green" : "yellow");
  console.log(chalk.hex("#58a6ff")("  │"));
  warnLine("Tekan Ctrl+C untuk menghentikan gateway");
  sectionFooter();

  // Load gateway
  process.env._EMORA_GATEWAY_MANUAL = "1";
  const { loadGateways } = await import("../gateway/index.js");
  await loadGateways();

  // Keep process alive
  process.stdin.resume();

  // Graceful shutdown
  async function shutdown(sig) {
    console.log(C.yellow(`\n\n  [GATEWAY] Menerima ${sig}, menutup koneksi...\n`));
    process.exit(0);
  }
  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
