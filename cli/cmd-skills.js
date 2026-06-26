/**
 * cli/cmd-skills.js — `emora skills`
 * Browse, inspect, dan kelola skill secara interaktif.
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { select, confirm, sectionHeader, sectionFooter, infoLine, successLine, warnLine, errorLine } from "./select.js";

// Use chalk instances (chainable) instead of arrow functions
const C = {
  cyan:    chalk.hex("#58a6ff"),
  green:   chalk.hex("#3fb950"),
  yellow:  chalk.hex("#d29922"),
  red:     chalk.hex("#f85149"),
  purple:  chalk.hex("#a371f7"),
  muted:   chalk.hex("#8b949e"),
  dim:     chalk.hex("#6e7681"),
  primary: chalk.hex("#e6edf3"),
};

const SKILL_DIR = "./skill";

/**
 * Mencari file skill.md dalam berbagai variasi kapitalisasi
 * @param {string} skillDir - Path ke direktori skill
 * @returns {string|null} - Path file yang ditemukan atau null
 */
function findSkillMd(skillDir) {
  if (!fs.existsSync(skillDir)) return null;
  
  try {
    const files = fs.readdirSync(skillDir);
    // Cari file yang cocok dengan "skill.md" secara case-insensitive
    const skillMdFile = files.find(file => 
      file.toLowerCase() === "skill.md" && 
      fs.statSync(path.join(skillDir, file)).isFile()
    );
    return skillMdFile ? path.join(skillDir, skillMdFile) : null;
  } catch {
    return null;
  }
}

function loadSkills() {
  if (!fs.existsSync(SKILL_DIR)) return [];
  return fs.readdirSync(SKILL_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const name = d.name;
      let meta = {};
      try {
        meta = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, name, "meta.json"), "utf8"));
      } catch {}
      
      const skillMdPath = findSkillMd(path.join(SKILL_DIR, name));
      const hasMd = skillMdPath !== null;
      const mdSize = hasMd ? fs.statSync(skillMdPath).size : 0;
      const hasScript = fs.existsSync(path.join(SKILL_DIR, name, "run.sh"));
      
      return { 
        name, 
        meta, 
        hasScript, 
        hasMd, 
        mdSize,
        _skillMdPath: skillMdPath // Simpan path untuk digunakan nanti
      };
    });
}

/**
 * Membaca konten skill.md dari skill
 * @param {Object} skill - Object skill yang memiliki _skillMdPath
 * @returns {string} - Konten file skill.md
 */
function readSkillMd(skill) {
  if (!skill.hasMd || !skill._skillMdPath) return "";
  try {
    return fs.readFileSync(skill._skillMdPath, "utf8");
  } catch {
    return "";
  }
}

function printSkillDetail(skill) {
  const w = Math.min(process.stdout.columns || 80, 88);
  console.log();
  console.log(C.cyan.bold("  ╭─ SKILL: ") + C.purple.bold(skill.name) + " " + C.dim("─".repeat(Math.max(0, w - skill.name.length - 14))));

  const lines = [
    ["Nama",        skill.name],
    ["Deskripsi",   skill.meta.description || "—"],
    ["Versi",       skill.meta.version || "—"],
    ["Author",      skill.meta.author || "EMORA Skill Factory"],
    ["Dibuat",      skill.meta.created_at ? new Date(skill.meta.created_at).toLocaleDateString("id-ID") : "—"],
    ["Punya Script",skill.hasScript ? "Ya (run.sh)" : "Tidak"],
    ["Ukuran doc",  skill.mdSize ? `${(skill.mdSize / 1024).toFixed(1)} KB` : "—"],
  ];

  lines.forEach(([k, v]) => {
    console.log(C.cyan("  │  ") + C.muted(String(k).padEnd(18)) + C.primary(String(v)));
  });

  // Tampilkan isi skill.md (ringkas)
  if (skill.hasMd) {
    const md = readSkillMd(skill);
    if (md) {
      const preview = md.split("\n").slice(0, 20);
      console.log(C.cyan("  │"));
      console.log(C.cyan("  │  ") + C.purple.bold("PREVIEW skill.md:"));
      preview.forEach(l => {
        let out = l;
        if (l.startsWith("##")) out = C.cyan(l);
        else if (l.startsWith("#")) out = C.purple.bold(l);
        else if (l.startsWith("- ") || l.startsWith("· ")) out = C.muted(l);
        console.log(C.cyan("  │  ") + out);
      });
      if (md.split("\n").length > 20) {
        console.log(C.cyan("  │  ") + C.dim(`… ${md.split("\n").length - 20} baris lagi`));
      }
    }
  }

  console.log(C.cyan.bold("  ╰" + "─".repeat(w - 3)));
  console.log();
}

function auditSkills(skills) {
  sectionHeader("SKILL AUDIT", `Total ${skills.length} skill`);
  let issues = 0;

  for (const sk of skills) {
    const problems = [];
    if (!sk.hasMd)                      problems.push("skill.md tidak ada");
    if (!sk.meta.description)           problems.push("description kosong di meta.json");
    if (!sk.meta.version)               problems.push("version tidak ada di meta.json");
    if (sk.mdSize > 0 && sk.mdSize < 200) problems.push("skill.md terlalu singkat (< 200 bytes)");

    if (problems.length) {
      issues++;
      console.log(C.cyan("  │  ") + C.red("✗ ") + C.primary(sk.name));
      problems.forEach(p => console.log(C.cyan("  │      ") + C.yellow("⚠ " + p)));
    } else {
      console.log(C.cyan("  │  ") + C.green("✓ ") + C.muted(sk.name));
    }
  }

  console.log(C.cyan("  │"));
  if (issues === 0) {
    successLine(`Semua ${skills.length} skill dalam kondisi baik`);
  } else {
    warnLine(`${issues} skill punya masalah yang perlu diperbaiki`);
  }
  sectionFooter();
}

export async function cmdSkills(argv) {
  const subCmd = argv[0];

  // `emora skills audit` — langsung audit tanpa menu
  if (subCmd === "audit") {
    const skills = loadSkills();
    if (!skills.length) {
      sectionHeader("SKILLS", "Belum ada skill");
      warnLine("Buat skill pertama dengan ngobrol ke EMORA dan minta dia membuat skill baru.");
      sectionFooter();
      return;
    }
    auditSkills(skills);
    return;
  }

  // `emora skills list` — print list tanpa interaktif
  if (subCmd === "list") {
    const skills = loadSkills();
    sectionHeader("AVAILABLE SKILLS", `${skills.length} skill`);
    if (!skills.length) {
      warnLine("Belum ada skill.");
    } else {
      skills.forEach(sk => {
        infoLine(sk.name, sk.meta.description?.slice(0, 52) + (sk.meta.description?.length > 52 ? "…" : "") || "—");
      });
    }
    sectionFooter();
    return;
  }

  // Main interactive menu
  let running = true;
  while (running) {
    const skills = loadSkills();
    sectionHeader("SKILL MANAGER", `${skills.length} skill tersedia`);

    const action = await select("Pilih aksi:", [
      { label: "📋  Lihat semua skill",             value: "list"    },
      { label: "🔍  Inspect skill tertentu",        value: "inspect" },
      { label: "🔎  Audit semua skill",             value: "audit"   },
      { label: "🗑️   Hapus skill",                   value: "delete"  },
      { label: "←   Keluar",                         value: "exit"    },
    ]);

    switch (action) {
      case "list": {
        console.log();
        if (!skills.length) {
          warnLine("Belum ada skill.");
        } else {
          skills.forEach(sk => {
            console.log(
              C.cyan("  │  ") + C.green("▸ ") + C.primary(sk.name.padEnd(30)) +
              C.dim((sk.meta.description || "").slice(0, 48))
            );
          });
        }
        console.log();
        break;
      }

      case "inspect": {
        if (!skills.length) { warnLine("Belum ada skill."); break; }
        const chosen = await select("Pilih skill:", skills.map(sk => ({
          label: `${sk.name.padEnd(32)} ${(sk.meta.description||"").slice(0,36)}`,
          value: sk.name,
        })));
        const sk = skills.find(s => s.name === chosen);
        if (sk) printSkillDetail(sk);
        break;
      }

      case "audit": {
        auditSkills(skills);
        break;
      }

      case "delete": {
        if (!skills.length) { warnLine("Belum ada skill."); break; }
        const chosen = await select("Pilih skill yang akan dihapus:", skills.map(sk => ({
          label: sk.name,
          value: sk.name,
        })));
        const ok = await confirm(`Hapus skill "${chosen}"? Tidak bisa dikembalikan.`, { default: false });
        if (ok) {
          try {
            fs.rmSync(path.join(SKILL_DIR, chosen), { recursive: true });
            successLine(`Skill "${chosen}" berhasil dihapus`);
          } catch (err) {
            errorLine(`Gagal menghapus: ${err.message}`);
          }
        } else {
          warnLine("Penghapusan dibatalkan");
        }
        console.log();
        break;
      }

      case "exit":
        running = false;
        sectionFooter();
        break;
    }
  }
}