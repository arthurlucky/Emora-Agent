/**
 * gateway/service/windows.js — Windows Scheduled Task (via schtasks.exe)
 */
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const TASK_NAME = "EmoraGateway";

export async function install({ command, args, cwd }) {
  const fullCommand = `"${command}" ${args.map((a) => `"${a}"`).join(" ")}`;
  await execFileAsync("schtasks", [
    "/Create", "/TN", TASK_NAME,
    "/TR", fullCommand,
    "/SC", "ONLOGON",
    "/RL", "HIGHEST",
    "/F",
  ], { cwd });

  return { ok: true, note: `Scheduled Task "${TASK_NAME}" dibuat (jalan otomatis saat login).` };
}

export async function uninstall() {
  try {
    await execFileAsync("schtasks", ["/Delete", "/TN", TASK_NAME, "/F"]);
  } catch { /* mungkin memang belum ada */ }
  return { ok: true };
}

export async function status() {
  try {
    const { stdout } = await execFileAsync("schtasks", ["/Query", "/TN", TASK_NAME, "/FO", "LIST"]);
    const active = /Status:\s*Running/i.test(stdout);
    return { installed: true, active, raw: stdout.trim() };
  } catch {
    return { installed: false, active: false, raw: "task not found" };
  }
}

export async function restart(daemonCmd) {
  try {
    await execFileAsync("schtasks", ["/End", "/TN", TASK_NAME]);
  } catch { /* mungkin belum jalan */ }
  try {
    await execFileAsync("schtasks", ["/Run", "/TN", TASK_NAME]);
    return { ok: true };
  } catch {
    return install(daemonCmd);
  }
}
