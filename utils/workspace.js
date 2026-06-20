import path from "path";
import fs from "fs";

export const ROOT_DIR = path.resolve(process.cwd());

// 🟢 UBAH DISINI: Jadikan Root Project sebagai default directory
export const WORKSPACE_DIR = ROOT_DIR;

export function resolveWorkspacePath(targetPath = "") {
  let cleanPath = targetPath.trim();

  // Tetap simpan ini untuk berjaga-jaga jika AI masih berhalusinasi mengetik 'workspaces/'
  cleanPath = cleanPath.replace(/^(\.\/)?workspaces\/?/, "");

  let resolved;
  
  if (path.isAbsolute(cleanPath)) {
    resolved = path.resolve(cleanPath);
  } else {
    // Sekarang secara default path akan di-resolve langsung di Root Project
    resolved = path.resolve(WORKSPACE_DIR, cleanPath);
  }

  // 🛡️ KEAMANAN (Opsional tapi disarankan): 
  // Tetap cegah AI mengakses file sensitif di luar folder proyekmu (seperti /etc/ atau C:\Windows)
  if (!resolved.startsWith(ROOT_DIR)) {
    throw new Error("Akses ditolak: Operasi file tidak diizinkan di luar Root Project.");
  }

  return resolved;
}
