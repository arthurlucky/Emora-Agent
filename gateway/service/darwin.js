/**
 * gateway/service/darwin.js — launchd user agent (~/Library/LaunchAgents)
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const LABEL = "com.emora.gateway";
const AGENT_DIR = path.join(os.homedir(), "Library", "LaunchAgents");
const PLIST_PATH = path.join(AGENT_DIR, `${LABEL}.plist`);
const LOG_DIR = path.join(os.homedir(), ".emora", "logs");

function xmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plistContent({ command, args, cwd }) {
  const argXml = [command, ...args]
    .map((a) => `        <string>${xmlEscape(a)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${argXml}
    </array>
    <key>WorkingDirectory</key>
    <string>${xmlEscape(cwd)}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${xmlEscape(path.join(LOG_DIR, "gateway.out.log"))}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(path.join(LOG_DIR, "gateway.err.log"))}</string>
</dict>
</plist>
`;
}

export async function install(daemonCmd) {
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(PLIST_PATH, plistContent(daemonCmd));

  try { await execFileAsync("launchctl", ["unload", PLIST_PATH]); } catch { /* belum ke-load, gapapa */ }
  await execFileAsync("launchctl", ["load", "-w", PLIST_PATH]);

  return { ok: true, path: PLIST_PATH };
}

export async function uninstall() {
  try { await execFileAsync("launchctl", ["unload", PLIST_PATH]); } catch { /* noop */ }
  try { fs.unlinkSync(PLIST_PATH); } catch { /* sudah gak ada */ }
  return { ok: true };
}

export async function status() {
  try {
    const { stdout } = await execFileAsync("launchctl", ["list", LABEL]);
    return { installed: fs.existsSync(PLIST_PATH), active: true, raw: stdout.trim() };
  } catch {
    return { installed: fs.existsSync(PLIST_PATH), active: false, raw: "not loaded" };
  }
}

export async function restart(daemonCmd) {
  if (!fs.existsSync(PLIST_PATH)) return install(daemonCmd);
  try { await execFileAsync("launchctl", ["unload", PLIST_PATH]); } catch { /* noop */ }
  await execFileAsync("launchctl", ["load", "-w", PLIST_PATH]);
  return { ok: true };
}
