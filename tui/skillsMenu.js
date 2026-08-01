/**
 * tui/skillsMenu.js
 *
 * Data & aksi buat menu `/skills` di TUI. Scan folder skill/ (format
 * EMORA: satu folder per skill, berisi meta.json + skill.md) dan toggle
 * enable/disable dengan cara paling non-destruktif: rename folder pakai
 * suffix `.disabled` (di-skip oleh buildSkillCatalog() di core/chat.js,
 * jadi begitu di-toggle langsung ngaruh ke system prompt tanpa restart).
 */
import fs from "fs/promises";
import path from "path";
import { invalidateSystemPromptCache } from "../core/chat.js";

const SKILL_DIR = path.resolve("./skill");

export async function listSkillsForMenu() {
  let entries;
  try {
    entries = await fs.readdir(SKILL_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const enabled = !e.name.endsWith(".disabled");
    const baseName = enabled ? e.name : e.name.slice(0, -".disabled".length);

    let description = "(tanpa deskripsi)";
    try {
      const metaRaw = await fs.readFile(path.join(SKILL_DIR, e.name, "meta.json"), "utf8");
      description = JSON.parse(metaRaw).description || description;
    } catch {
      try {
        const mdRaw = await fs.readFile(path.join(SKILL_DIR, e.name, "skill.md"), "utf8");
        description = mdRaw.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "") || description;
      } catch { /* skill kosong/rusak, tetap tampilkan dengan deskripsi default */ }
    }

    out.push({ name: baseName, dirName: e.name, description, enabled });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function toggleSkill(skill) {
  const from = path.join(SKILL_DIR, skill.dirName);
  const to = skill.enabled
    ? path.join(SKILL_DIR, skill.dirName + ".disabled")
    : path.join(SKILL_DIR, skill.dirName.replace(/\.disabled$/, ""));

  await fs.rename(from, to);
  invalidateSystemPromptCache();
  return { ...skill, dirName: path.basename(to), enabled: !skill.enabled };
}
