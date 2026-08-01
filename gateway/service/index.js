/**
 * gateway/service/index.js
 *
 * Dispatcher untuk install/uninstall EMORA gateway sebagai service OS
 * (systemd user service di Linux, launchd agent di macOS, Scheduled Task
 * di Windows) supaya gateway tetap jalan di background setelah reboot /
 * logout, tanpa harus buka terminal terus-terusan.
 */
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const BIN_PATH = path.join(PROJECT_ROOT, "bin", "emora.js");

export function daemonCommand() {
  return { command: process.execPath, args: [BIN_PATH, "gateway", "run"], cwd: PROJECT_ROOT };
}

async function loadImpl() {
  switch (process.platform) {
    case "linux":
      return import("./linux.js");
    case "darwin":
      return import("./darwin.js");
    case "win32":
      return import("./windows.js");
    default:
      throw new Error(`Install service belum didukung di platform '${process.platform}'.`);
  }
}

export async function installService() {
  const impl = await loadImpl();
  return impl.install(daemonCommand());
}

export async function uninstallService() {
  const impl = await loadImpl();
  return impl.uninstall();
}

export async function serviceStatus() {
  const impl = await loadImpl();
  return impl.status();
}

export async function restartService() {
  const impl = await loadImpl();
  return impl.restart(daemonCommand());
}
