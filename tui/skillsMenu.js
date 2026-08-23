/**
 * tui/skillsMenu.js
 *
 * Data & aksi buat menu `/skills` di TUI. Menampilkan GABUNGAN skill
 * bawaan (folder skill/, bisa di-toggle on/off) DAN skill+command dari
 * plugin (./plugins/<id>/{skills,commands}/, format standar Claude Code —
 * read-only di menu ini, dikelola lewat `/plugin enable|disable <id>` per
 * plugin, bukan per-skill).
 *
 * Toggle skill bawaan: rename folder pakai suffix `.disabled` (di-skip
 * oleh core/skillRegistry.js, jadi begitu di-toggle langsung ngaruh ke
 * system prompt tanpa restart).
 */
import fs from "fs/promises";
import path from "path";
import { invalidateSystemPromptCache } from "../core/chat.js";
import skillRegistry from "../core/skillRegistry.js";

const SKILL_DIR = path.resolve("./skill");

export async function listSkillsForMenu() {
  let entries;
  try {
    entries = await fs.readdir(SKILL_DIR, { withFileTypes: true });
  } catch {
    entries = [];
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

    out.push({ name: baseName, dirName: e.name, description, enabled, source: "builtin", toggleable: true });
  }

  // Tambahkan skill & command dari plugin — read-only di menu ini.
  try {
    const pluginEntries = await skillRegistry.listAll();
    for (const p of pluginEntries) {
      if (p.source === "builtin") continue; // sudah kehandle di scan di atas
      out.push({
        name: `${p.slashName} [${p.kind}]`,
        dirName: null,
        description: p.description || "(tanpa deskripsi)",
        enabled: true,
        source: p.source,
        toggleable: false,
      });
    }
  } catch { /* plugins/ belum ada dsb — abaikan, skill bawaan tetap tampil */ }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function toggleSkill(skill) {
  if (!skill.toggleable) {
    throw new Error(`Skill/command dari plugin (${skill.source}) tidak bisa di-toggle per-item — pakai "/plugin disable ${(skill.source || "").replace("plugin:", "")}" untuk nonaktifkan seluruh plugin-nya.`);
  }
  const from = path.join(SKILL_DIR, skill.dirName);
  const to = skill.enabled
    ? path.join(SKILL_DIR, skill.dirName + ".disabled")
    : path.join(SKILL_DIR, skill.dirName.replace(/\.disabled$/, ""));

  await fs.rename(from, to);
  invalidateSystemPromptCache();
  return { ...skill, dirName: path.basename(to), enabled: !skill.enabled };
}
