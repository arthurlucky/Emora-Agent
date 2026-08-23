/**
 * tui/theme-rpg.js
 *
 * Tema "RPG Manhwa" ala Solo Leveling — kulit visual saja, logika agent
 * tidak berubah. Aktif via /skin rpg di TUI, disimpan ke .emora/skin.json.
 *
 * ponytail: string wrapper murni; XP/level persist sederhana (json), bukan
 * game engine. Upgrade: quest system nyata kalau mau lebih dalam.
 */
import fsSync from "fs";

const SKIN_FILE = ".emora/skin.json";
const RPG_FILE = ".emora/rpg.json";

export const SKINS = ["clean", "rpg"];

export function getSkin() {
  try {
    const { skin } = JSON.parse(fsSync.readFileSync(SKIN_FILE, "utf8"));
    return SKINS.includes(skin) ? skin : "clean";
  } catch {
    return process.env.THEME === "rpg" ? "rpg" : "clean";
  }
}

export function setSkin(skin) {
  if (!SKINS.includes(skin)) throw new Error(`Skin tidak dikenal: ${skin}. Pilihan: ${SKINS.join(", ")}`);
  fsSync.mkdirSync(".emora", { recursive: true });
  let cfg = {};
  try { cfg = JSON.parse(fsSync.readFileSync(SKIN_FILE, "utf8")); } catch {}
  cfg.skin = skin;
  fsSync.writeFileSync(SKIN_FILE, JSON.stringify(cfg, null, 2));
}

// ── Progress (XP/Level) ──────────────────────────────────────────────────────
function loadProgress() {
  try {
    const p = JSON.parse(fsSync.readFileSync(RPG_FILE, "utf8"));
    return { xp: p.xp || 0, level: p.level || 1, quests: p.quests || 0 };
  } catch {
    return { xp: 0, level: 1, quests: 0 };
  }
}

export function addXP(amount = 10) {
  const p = loadProgress();
  p.xp += amount;
  // Level threshold: 100 * level^1.3 (makin tinggi makin lambat).
  let leveledUp = false;
  for (;;) {
    const need = needed(p.level);
    if (p.xp < need) break;
    p.xp -= need;
    p.level++;
    p.quests++;
    leveledUp = true;
  }
  fsSync.mkdirSync(".emora", { recursive: true });
  fsSync.writeFileSync(RPG_FILE, JSON.stringify(p));
  return { ...p, leveledUp };
}
function needed(level) {
  return Math.floor(100 * Math.pow(level, 1.3));
}

// ── Renderers ────────────────────────────────────────────────────────────────
/** Notifikasi gaya "System" manhwa. Return array of lines (sudah styled). */
export function systemNotice(text, colorFn) {
  const c = colorFn || ((s) => s);
  return [c("⌈ SYSTEM ⌋"), c("  " + text)];
}

/** Header alternatif saat skin=rpg. */
export function rpgHeader(baseLine) {
  return baseLine.replace("◆ EMORA", "⌈ EMORA ⌋");
}

/** Welcome screen versi RPG. */
export function rpgWelcome(lines) {
  const p = loadProgress();
  return [
    "",
    "  ⌈ SYSTEM ⌋ — Agent siap.",
    `  RANK: ${p.level} · XP: ${p.xp}`,
    "",
    "  Quest tersedia:",
    "  • Tanya apa saja — agent akan memakai skill & tool",
    "  • /skills   → SKILL WINDOW",
    "  • /help     → daftar perintah",
    "  • /mode plan→ mode baca-saja",
    "",
  ];
}

/** Skill list dirender sebagai SKILL WINDOW. */
export function rpgSkillWindow(entries) {
  const out = ["⌈ SKILL WINDOW ⌋"];
  for (const s of entries) {
    out.push(`  ◈ ${("/" + s.slashName).padEnd(30)} ${String(s.description || "").slice(0, 50)}`);
  }
  return out;
}
