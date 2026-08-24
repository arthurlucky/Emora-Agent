/**
 * library/storage.js — Knowledge Library storage resolver (V3).
 *
 * Menentukan ROOT penyimpanan knowledge berdasarkan KL_VAULT:
 *   default  → ./library   (tetap, backward compatible)
 *   obsidian → <OBSIDIAN_VAULT_PATH>/EMORA/Knowledge  (auto-create struktur)
 *   custom   → <KL_VAULT_PATH>                        (auto-create struktur)
 *
 * Env: KL_VAULT=default|obsidian|custom · KL_VAULT_PATH=<abs path>
 * Konfigurasi lewat `emora kl vault` (menulis .env).
 */
import fs from "fs";
import path from "path";

export const VAULT_MODES = ["default", "obsidian", "custom"];

/** Baca nilai .env tanpa dep. */
function env(key) {
  try {
    const m = fs.readFileSync(".env", "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
    return m ? m[1].trim() : "";
  } catch {
    return process.env[key] || "";
  }
}

/** Subfolder knowledge di dalam vault Obsidian (biar tidak campur dgn catatan). */
const OBSIDIAN_KL_SUBDIR = "EMORA/Knowledge";

/**
 * Resolve & JAMIN direktori root knowledge ada.
 * @returns {{ root: string, mode: string, label: string }}
 */
export function resolveKnowledgeRoot() {
  const mode = (env("KL_VAULT") || "default").toLowerCase();
  let root;

  if (mode === "obsidian") {
    const vault = env("OBSIDIAN_VAULT_PATH");
    if (!vault) {
      // Obsidian vault belum dikonfigurasi → fallback default.
      root = path.resolve("./library");
    } else {
      root = path.join(path.resolve(vault), OBSIDIAN_KL_SUBDIR);
    }
  } else if (mode === "custom") {
    root = path.resolve(env("KL_VAULT_PATH") || "./library");
  } else {
    root = path.resolve("./library");
  }

  // Auto-create struktur (default/custom: root; obsidian: root juga).
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, ".index"), { recursive: true });

  return { root, mode: VAULT_MODES.includes(mode) ? mode : "default", label: root };
}