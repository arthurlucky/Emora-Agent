/**
 * gateway/service/linux.js — systemd user service (~/.config/systemd/user)
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const SERVICE_NAME = "emora-gateway";
const UNIT_DIR = path.join(os.homedir(), ".config", "systemd", "user");
const UNIT_PATH = path.join(UNIT_DIR, `${SERVICE_NAME}.service`);

function unitFileContent({ command, args, cwd }) {
  return `[Unit]
Description=EMORA Gateway (Telegram/WhatsApp/Discord bridge)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${cwd}
ExecStart=${command} ${args.map((a) => `"${a}"`).join(" ")}
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
}

async function systemctl(...args) {
  return execFileAsync("systemctl", ["--user", ...args]);
}

export async function install(daemonCmd) {
  fs.mkdirSync(UNIT_DIR, { recursive: true });
  fs.writeFileSync(UNIT_PATH, unitFileContent(daemonCmd));

  await systemctl("daemon-reload");
  await systemctl("enable", SERVICE_NAME);
  await systemctl("start", SERVICE_NAME);

  return {
    ok: true,
    path: UNIT_PATH,
    note: "Kalau ingin tetap jalan setelah logout, aktifkan lingering: `loginctl enable-linger $USER`.",
  };
}

export async function uninstall() {
  try { await systemctl("stop", SERVICE_NAME); } catch { /* mungkin sudah berhenti */ }
  try { await systemctl("disable", SERVICE_NAME); } catch { /* mungkin sudah disabled */ }
  try { fs.unlinkSync(UNIT_PATH); } catch { /* sudah gak ada */ }
  try { await systemctl("daemon-reload"); } catch { /* noop */ }
  return { ok: true };
}

export async function status() {
  try {
    const { stdout } = await execFileAsync("systemctl", ["--user", "is-active", SERVICE_NAME]);
    return { installed: fs.existsSync(UNIT_PATH), active: stdout.trim() === "active", raw: stdout.trim() };
  } catch (err) {
    return { installed: fs.existsSync(UNIT_PATH), active: false, raw: err.stdout?.trim() || "inactive" };
  }
}

export async function restart(daemonCmd) {
  if (!fs.existsSync(UNIT_PATH)) return install(daemonCmd);
  await systemctl("restart", SERVICE_NAME);
  return { ok: true };
}
