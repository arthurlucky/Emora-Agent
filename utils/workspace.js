import path from "path";
import os from "os";

export const ROOT_DIR = path.resolve(process.cwd());
export const PLATFORM = os.platform(); // 'win32' (Windows), 'linux', 'darwin' (Mac), 'android' (Termux)

// Jadikan Root Project sebagai default directory
export const WORKSPACE_DIR = ROOT_DIR;

export function resolveWorkspacePath(targetPath = "") {
  let cleanPath = targetPath.trim();

  // Tetap simpan ini untuk berjaga-jaga jika AI masih berhalusinasi mengetik 'workspaces/'
  cleanPath = cleanPath.replace(/^(\.\/)?workspaces\/?/, "");

  let resolved;
  
  // 🟢 LOGIKA BEBAS AKSES:
  // Jika path yang dikasih AI adalah path absolut (contoh: C:\Users\... atau /data/data/com.termux/...)
  if (path.isAbsolute(cleanPath)) {
    resolved = path.resolve(cleanPath);
  } else {
    // Jika relatif, arahkan langsung ke root project Emora-Agent
    resolved = path.resolve(WORKSPACE_DIR, cleanPath);
  }

  return resolved;
}
