/**
 * gateway/daemon.js
 *
 * Manajemen PID file untuk mode daemon (`emora gateway run`) plus lock file
 * supaya TUI dan daemon tidak sama-sama merebut gateway yang sama secara
 * bersamaan. Path disimpan relatif ke project (bukan home dir).
 */
import fs from "fs";
import path from "path";

const PID_FILE = path.resolve("./.gateway.pid");
const TUI_LOCK_FILE = path.resolve("./.tui-gateway.lock");

function processAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM"; // proses ada tapi kita gak punya izin -> anggap alive
  }
}

export function pidFilePath() {
  return PID_FILE;
}

export function writePID(pid = process.pid) {
  fs.writeFileSync(PID_FILE, String(pid));
}

export function readPID() {
  try {
    const raw = fs.readFileSync(PID_FILE, "utf8").trim();
    const pid = parseInt(raw, 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function removePID() {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    /* sudah gak ada, gapapa */
  }
}

export function isRunning() {
  const pid = readPID();
  if (!pid) return false;
  if (processAlive(pid)) return true;
  removePID(); // stale pid file dari proses yang udah mati
  return false;
}

export function daemonStatus() {
  const pid = readPID();
  const running = isRunning();
  return { running, pid: running ? pid : null };
}

export function stopDaemon() {
  const pid = readPID();
  if (!pid || !processAlive(pid)) {
    removePID();
    throw new Error("Tidak ada gateway daemon yang sedang berjalan.");
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    throw new Error(`Gagal menghentikan daemon (PID ${pid}): ${err.message}`);
  }
  removePID();
  return pid;
}

/**
 * Dipakai TUI supaya tidak start gateway kalau daemon terpisah sudah pegang
 * kendali, dan supaya dua sesi TUI tidak double-start gateway yang sama.
 */
export function tryAcquireTUIGatewayLock() {
  if (isRunning()) return false;
  try {
    const raw = fs.readFileSync(TUI_LOCK_FILE, "utf8").trim();
    const pid = parseInt(raw, 10);
    if (Number.isFinite(pid) && processAlive(pid) && pid !== process.pid) return false;
  } catch {
    /* belum ada lock file, lanjut ambil */
  }
  try {
    fs.writeFileSync(TUI_LOCK_FILE, String(process.pid));
    return true;
  } catch {
    return false;
  }
}

export function releaseTUIGatewayLock() {
  try {
    const raw = fs.readFileSync(TUI_LOCK_FILE, "utf8").trim();
    if (parseInt(raw, 10) === process.pid) fs.unlinkSync(TUI_LOCK_FILE);
  } catch {
    /* noop */
  }
}
