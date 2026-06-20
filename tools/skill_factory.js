import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";

import {
  getPatterns,
  getPatternByKey,
  markSkillCreated,
  deletePattern,
  resetPatternCount,
  SKILL_THRESHOLD,
} from "../utils/patternTracker.js";

const SKILL_DIR = "./skill";
const FACTORY_DIR = "./skill_factory";

// ==========================================
// HELPERS
// ==========================================

async function ensureDirs() {
  await fs.mkdir(SKILL_DIR, { recursive: true });
  await fs.mkdir(FACTORY_DIR, { recursive: true });
}

function toSafeName(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_\-]/g, "");
}

async function readFileSafe(filePath) {
  try {
    return await fs.readFile(path.resolve(filePath), "utf8");
  } catch {
    return null;
  }
}

// Append skill ke index utama skill/SKILL.md
async function appendToSkillIndex(safeName, description) {
  const indexPath = path.join(SKILL_DIR, "SKILL.md");
  try {
    let index = await fs.readFile(indexPath, "utf8");
    if (!index.includes(safeName)) {
      index += `\n- **${safeName}**: ${description}`;
      await fs.writeFile(indexPath, index, "utf8");
    }
  } catch {
    // SKILL.md belum ada, biarkan saja
  }
}

// ==========================================
// SKILL FACTORY TOOL
// ==========================================

export const skillFactoryTool = new DynamicStructuredTool({
  name: "skill_factory",
  description:
    "Mengelola Skill Factory EMORA: lihat pola tool yang terdeteksi, buat skill otomatis dari pola tersebut, kelola skill yang sudah ada. Actions: list_patterns, create_skill, list_skills, read_skill, delete_pattern, reset_pattern.",
  schema: z.object({
    action: z
      .enum([
        "list_patterns",
        "create_skill",
        "list_skills",
        "read_skill",
        "delete_pattern",
        "reset_pattern",
      ])
      .describe("Aksi yang akan dilakukan"),

    // Untuk create_skill
    pattern_key: z
      .string()
      .optional()
      .describe(
        "Key pola dari list_patterns yang akan dijadikan dasar skill (opsional jika membuat skill manual)"
      ),
    skill_name: z
      .string()
      .optional()
      .describe("Nama skill (huruf kecil, tanpa spasi). Contoh: web_research"),
    skill_description: z
      .string()
      .optional()
      .describe("Deskripsi singkat satu kalimat tentang fungsi skill ini"),
    skill_content: z
      .string()
      .optional()
      .describe(
        "Isi dokumen skill dalam format Markdown. Wajib mengikuti template: name, deskripsi, versi, trigger, langkah-langkah, contoh, catatan."
      ),
    skill_script: z
      .string()
      .optional()
      .describe(
        "Script shell opsional (.sh) yang bisa dijadikan template otomasi untuk skill ini"
      ),

    // Untuk read/delete
    skill_name_target: z
      .string()
      .optional()
      .describe("Nama skill yang ingin dibaca atau dihapus dari list_skills"),
  }),

  async func({
    action,
    pattern_key,
    skill_name,
    skill_description,
    skill_content,
    skill_script,
    skill_name_target,
  }) {
    try {
      await ensureDirs();

      switch (action) {
        // ──────────────────────────────────────────
        // LIST PATTERNS - Tampilkan semua pola terdeteksi
        // ──────────────────────────────────────────
        case "list_patterns": {
          const patterns = await getPatterns();
          const keys = Object.keys(patterns);

          if (keys.length === 0) {
            return JSON.stringify({
              success: true,
              message:
                "Belum ada pola terdeteksi. Pola akan muncul setelah rangkaian tool yang sama digunakan berulang kali.",
              patterns: [],
            });
          }

          const list = keys.map((key) => {
            const p = patterns[key];
            const progress = Math.min(p.count, SKILL_THRESHOLD);
            const bar =
              "█".repeat(progress) +
              "░".repeat(SKILL_THRESHOLD - progress) +
              ` ${p.count}/${SKILL_THRESHOLD}`;
            return {
              key,
              sequence: p.sequence,
              count: p.count,
              threshold: SKILL_THRESHOLD,
              progress_bar: bar,
              sessions_count: p.sessions.length,
              skill_created: p.skill_created,
              skill_name: p.skill_name || null,
              ready_for_skill: p.count >= SKILL_THRESHOLD && !p.skill_created,
              last_seen: p.last_seen
                ? new Date(p.last_seen).toLocaleString("id-ID")
                : null,
            };
          });

          // Sort: yang siap dijadikan skill dulu
          list.sort((a, b) => {
            if (a.ready_for_skill && !b.ready_for_skill) return -1;
            if (!a.ready_for_skill && b.ready_for_skill) return 1;
            return b.count - a.count;
          });

          return JSON.stringify({ success: true, patterns: list });
        }

        // ──────────────────────────────────────────
        // CREATE SKILL - Buat skill dari pola atau manual
        // ──────────────────────────────────────────
        case "create_skill": {
          if (!skill_name || !skill_content) {
            return JSON.stringify({
              success: false,
              error: "skill_name dan skill_content wajib diisi",
            });
          }

          const safeName = toSafeName(skill_name);
          if (!safeName) {
            return JSON.stringify({
              success: false,
              error: "skill_name tidak valid",
            });
          }

          const skillDir = path.join(SKILL_DIR, safeName);
          await fs.mkdir(skillDir, { recursive: true });

          // Simpan dokumen skill utama
          await fs.writeFile(
            path.join(skillDir, "skill.md"),
            skill_content,
            "utf8"
          );

          // Simpan script otomasi jika ada
          if (skill_script) {
            const scriptPath = path.join(skillDir, "run.sh");
            await fs.writeFile(scriptPath, skill_script, "utf8");
            // Buat executable
            await fs.chmod(scriptPath, 0o755).catch(() => {});
          }

          // Simpan metadata skill
          const meta = {
            name: safeName,
            description: skill_description || "(no description)",
            source_pattern: pattern_key || null,
            created_at: new Date().toISOString(),
            has_script: !!skill_script,
            version: "1.0.0",
          };
          await fs.writeFile(
            path.join(skillDir, "meta.json"),
            JSON.stringify(meta, null, 2),
            "utf8"
          );

          // Tandai pola sudah jadi skill
          if (pattern_key) {
            await markSkillCreated(pattern_key, safeName);
          }

          // Update index
          await appendToSkillIndex(
            safeName,
            skill_description || "Auto-generated skill"
          );

          return JSON.stringify({
            success: true,
            message: `✅ Skill '${safeName}' berhasil dibuat!`,
            path: skillDir,
            files: [
              "skill.md",
              ...(skill_script ? ["run.sh"] : []),
              "meta.json",
            ],
            pattern_linked: !!pattern_key,
          });
        }

        // ──────────────────────────────────────────
        // LIST SKILLS - Tampilkan semua skill yang ada
        // ──────────────────────────────────────────
        case "list_skills": {
          const entries = await fs.readdir(SKILL_DIR, {
            withFileTypes: true,
          }).catch(() => []);

          const skills = [];
          for (const e of entries) {
            if (!e.isDirectory()) continue;

            const metaRaw = await readFileSafe(
              path.join(SKILL_DIR, e.name, "meta.json")
            );
            const contentFirst = await readFileSafe(
              path.join(SKILL_DIR, e.name, "skill.md")
            );

            let meta = {};
            try {
              meta = metaRaw ? JSON.parse(metaRaw) : {};
            } catch {}

            const firstLine = contentFirst
              ? contentFirst
                  .split("\n")
                  .find((l) => l.trim())
                  ?.replace(/^#+\s*/, "") || e.name
              : e.name;

            skills.push({
              name: e.name,
              description: meta.description || firstLine,
              version: meta.version || "?",
              has_script: meta.has_script || false,
              source_pattern: meta.source_pattern || null,
              created_at: meta.created_at || null,
            });
          }

          return JSON.stringify({
            success: true,
            total: skills.length,
            skills,
          });
        }

        // ──────────────────────────────────────────
        // READ SKILL - Baca isi skill tertentu
        // ──────────────────────────────────────────
        case "read_skill": {
          if (!skill_name_target) {
            return JSON.stringify({
              success: false,
              error: "skill_name_target wajib diisi",
            });
          }
          const safeName = toSafeName(skill_name_target);
          const content = await readFileSafe(
            path.join(SKILL_DIR, safeName, "skill.md")
          );

          if (!content) {
            return JSON.stringify({
              success: false,
              error: `Skill '${safeName}' tidak ditemukan`,
            });
          }

          const script = await readFileSafe(
            path.join(SKILL_DIR, safeName, "run.sh")
          );

          return JSON.stringify({ success: true, skill_name: safeName, content, script: script || null });
        }

        // ──────────────────────────────────────────
        // DELETE PATTERN - Hapus pola dari tracker
        // ──────────────────────────────────────────
        case "delete_pattern": {
          if (!pattern_key) {
            return JSON.stringify({
              success: false,
              error: "pattern_key wajib diisi",
            });
          }
          await deletePattern(pattern_key);
          return JSON.stringify({
            success: true,
            message: `Pola '${pattern_key}' dihapus dari tracker`,
          });
        }

        // ──────────────────────────────────────────
        // RESET PATTERN - Reset counter pola (mulai hitung ulang)
        // ──────────────────────────────────────────
        case "reset_pattern": {
          if (!pattern_key) {
            return JSON.stringify({
              success: false,
              error: "pattern_key wajib diisi",
            });
          }
          await resetPatternCount(pattern_key);
          return JSON.stringify({
            success: true,
            message: `Counter pola '${pattern_key}' direset ke 0`,
          });
        }

        default:
          return JSON.stringify({
            success: false,
            error: `Action '${action}' tidak dikenal`,
          });
      }
    } catch (err) {
      return JSON.stringify({ success: false, error: err.message });
    }
  },
});
