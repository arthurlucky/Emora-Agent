/**
 * cli/vaultPicker.js — Folder picker interaktif ala file manager.
 *
 * Keys: ↑↓ navigasi · Enter masuk folder · Space konfirmasi pilih ·
 *       Left = naik ke parent · Esc batal · 'm' input path manual.
 *
 * Device-aware: start dir & shortcut berbeda per platform
 * (Termux/Android, Linux, macOS, Windows via Git Bash).
 *
 * Return: path absolut vault, atau null kalau dibatalkan.
 */
import fsSync from "fs";
import os from "os";
import path from "path";

/** Direktori awal & kandidat vault yang umum per platform. */
export function platformDefaults() {
  const home = os.homedir();
  const platform = process.platform; // android = Termux, linux, darwin, win32
  const candidates = [];

  if (platform === "android") {
    // Termux: shared storage Android (perlu termux-setup-storage).
    candidates.push(
      "/storage/emulated/0/Documents",
      "/storage/emulated/0/Download",
      "/storage/emulated/0",
      path.join(home, "storage", "shared"),
      home,
    );
  } else if (platform === "darwin") {
    candidates.push(
      path.join(home, "Documents"),
      path.join(home, "Library", "Mobile Documents", "iCloud~md~obsidian", "Documents"),
      home,
    );
  } else if (platform === "win32") {
    candidates.push(
      path.join(home, "Documents"),
      path.join(home, "OneDrive", "Documents"),
      "C:\\",
    );
  } else {
    // Linux
    candidates.push(
      path.join(home, "Documents"),
      path.join(home, "Obsidian"),
      home,
    );
  }
  return { startDir: candidates.find((c) => fsSync.existsSync(c)) || home, candidates };
}

/** List isi folder: folder dulu (alfabetis), file disembunyikan. */
function listDirs(dir) {
  try {
    return fsSync
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return []; // permission denied dsb — tampilkan kosong, tetap bisa naik
  }
}

/** Apakah folder ini terlihat seperti vault Obsidian (ada .obsidian di dalamnya). */
function isVault(dir) {
  try { return fsSync.existsSync(path.join(dir, ".obsidian")); } catch { return false; }
}

export function pickVaultFolder({ startDir } = {}) {
  const defaults = platformDefaults();
  let cwd = path.resolve(startDir || defaults.startDir);
  let entries = listDirs(cwd);
  // Item virtual: ".." (parent), ". (pilih folder ini)" selalu paling atas.
  const IDX_PARENT = 0;
  const IDX_HERE = 1;
  let idx = IDX_HERE;
  let manualMode = false;
  let manualBuf = "";

  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) { resolve(null); return; }
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    function cleanup() {
      if (stdin.isTTY) stdin.setRawMode(wasRaw || false);
      stdin.removeListener("data", onKey);
    }

    function render() {
      // Clear screen sederhana — cukup untuk picker.
      process.stdout.write("\x1b[2J\x1b[H");
      console.log("╭─ PILIH FOLDER VAULT " + "─".repeat(Math.max(0, (process.stdout.columns || 80) - 22)));
      console.log("│ " + cwd + (isVault(cwd) ? "  ✦ vault terdeteksi" : ""));
      console.log("│");
      if (manualMode) {
        console.log("│ Path manual: " + manualBuf + "█");
        console.log("│");
        console.log("│ Enter = pakai path ini · Esc = batal");
        return;
      }
      const items = [
        idx === IDX_PARENT ? "  ❯ .." : "    ..",
        idx === IDX_HERE
          ? "  ❯ [ PILIH FOLDER INI ]" + (isVault(cwd) ? "  ✦" : "")
          : "    [ PILIH FOLDER INI ]" + (isVault(cwd) ? "  ✦" : ""),
      ];
      entries.forEach((name, i) => {
        const gi = i + 2;
        const child = path.join(cwd, name);
        const mark = isVault(child) ? " ✦" : "";
        items.push(gi === idx ? "  ❯ 📁 " + name + mark : "    📁 " + name + mark);
      });
      // Window 15 item terlihat, geser mengikuti idx.
      const winStart = Math.max(0, Math.min(idx - 7, items.length - 15));
      for (const line of items.slice(winStart, winStart + 15)) console.log("│ " + line);
      console.log("│");
      console.log("│ ↑↓ navigasi · Enter masuk · Space pilih folder ini · ← naik · m path manual · Esc batal");
    }

    function confirmHere() {
      cleanup();
      process.stdout.write("\x1b[2J\x1b[H");
      resolve(cwd);
    }

    function onKey(raw) {
      // Tokenize (arrow bisa tergabung dalam satu chunk — sama seperti fix select.js).
      const tokens = String(raw).match(/\x1b\[[A-D]|\r|\n|\x7F|\x1b|[\s\S]/g) || [];
      for (const k of tokens) {
        if (manualMode) {
          if (k === "\x1b") { // Esc batal manual → kembali ke browser
            manualMode = false; manualBuf = ""; render(); continue;
          }
          if (k === "\r" || k === "\n") {
            const p = manualBuf.trim();
            if (!p) { manualMode = false; render(); continue; }
            const abs = path.resolve(p.replace(/^~(?=\/|$)/, os.homedir()));
            cleanup();
            process.stdout.write("\x1b[2J\x1b[H");
            resolve(abs);
            return;
          }
          if (k === "\x7F") { manualBuf = manualBuf.slice(0, -1); render(); continue; }
          if (k.length === 1 && k >= " ") { manualBuf += k; render(); }
          continue;
        }

        if (k === "\x03") { // Ctrl+C
          cleanup(); process.stdout.write("\x1b[2J\x1b[H"); resolve(null); return;
        }
        if (k === "\x1b") { // Esc
          cleanup(); process.stdout.write("\x1b[2J\x1b[H"); resolve(null); return;
        }
        if (k === "\x1b[A") { // Up
          idx = idx > 0 ? idx - 1 : idx; render(); continue;
        }
        if (k === "\x1b[B") { // Down
          const max = entries.length + 1;
          idx = idx < max ? idx + 1 : max; render(); continue;
        }
        if (k === "\x1b[D") { // Left = naik parent
          const parent = path.dirname(cwd);
          if (parent !== cwd) { cwd = parent; entries = listDirs(cwd); idx = IDX_HERE; render(); }
          continue;
        }
        if (k === "\r" || k === "\n") { // Enter masuk folder
          if (idx === IDX_PARENT) {
            const parent = path.dirname(cwd);
            if (parent !== cwd) { cwd = parent; entries = listDirs(cwd); idx = IDX_HERE; }
          } else if (idx >= 2) {
            const child = path.join(cwd, entries[idx - 2]);
            cwd = child; entries = listDirs(cwd); idx = IDX_HERE;
          }
          render(); continue;
        }
        if (k === " ") { // Space konfirmasi folder ini
          confirmHere(); return;
        }
        if (k === "m" || k === "M") { // manual path
          manualMode = true; manualBuf = cwd; render(); continue;
        }
      }
    }

    render();
    stdin.on("data", onKey);
  });
}
