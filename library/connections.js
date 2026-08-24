/**
 * library/connections.js — Knowledge Library v2: Skill ↔ Knowledge connections.
 *
 * Skill mendeklarasikan koneksi ke knowledge library lewat frontmatter:
 *
 *   ---
 *   name: yugen
 *   description: ...
 *   use_knowledge: true
 *   connection:
 *     - knowledge/keuangan/dasar
 *     - knowledge/investasi/saham
 *   ---
 *
 * API:
 *   getSkillConnections(skillName) → daftar path knowledge yang terhubung
 *   readConnectedKnowledge(skillName) → isi gabungan file di path tersebut
 *   resolveKnowledgePaths(paths) → validasi & resolve ke file .md/.txt aktual
 */
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { resolveKnowledgeRoot } from "./storage.js";

// LIBRARY_DIR dinamis mengikuti vault (default/obsidian/custom).
const { root: LIBRARY_DIR } = resolveKnowledgeRoot();

/** Parse frontmatter sederhana dari skill.md (tanpa dep YAML). */
export function parseSkillConnections(mdContent) {
  const m = mdContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { use_knowledge: false, connections: [] };

  const fm = m[1];
  const useK = /^\s*use_knowledge:\s*true/im.test(fm);

  // Blok connection: bisa list YAML (- item) atau inline [a, b]
  const connections = [];
  const connBlock = fm.match(/^connection:\s*$/im);
  if (connBlock) {
    const after = fm.slice(connBlock.index + connBlock[0].length);
    for (const line of after.split("\n")) {
      const item = line.match(/^\s*-\s*(.+)$/);
      if (item) connections.push(item[1].trim().replace(/["']/g, ""));
      else if (line.trim() && !line.startsWith(" ")) break; // keluar dari blok
    }
  }
  const inline = fm.match(/^connection:\s*\[(.+)\]$/im);
  if (inline) {
    for (const p of inline[1].split(",")) connections.push(p.trim().replace(/["']/g, ""));
  }

  return { use_knowledge: useK || connections.length > 0, connections: [...new Set(connections)] };
}

/** Baca koneksi skill dari folder skill/<name>/. */
export async function getSkillConnections(skillName) {
  for (const fname of ["skill.md", "SKILL.md"]) {
    try {
      const raw = await fs.readFile(path.join("skill", skillName, fname), "utf8");
      return parseSkillConnections(raw);
    } catch {}
  }
  return { use_knowledge: false, connections: [] };
}

/**
 * Resolve daftar logical path ("knowledge/topik/subtopik") → daftar file
 * aktual di library/. Path boleh tanpa prefix "knowledge/".
 */
export async function resolveKnowledgePaths(paths) {
  const files = [];
  for (const p of paths || []) {
    const clean = String(p).replace(/^knowledge\/?/, "").replace(/^\/+/, "");
    const absDir = path.join(LIBRARY_DIR, clean);
    let stat;
    try { stat = await fs.stat(absDir); } catch { continue; }

    if (stat.isFile()) {
      files.push({ relPath: path.join("library", clean), absPath: absDir });
      continue;
    }
    // Direktori → ambil semua file rekurif
    await walk(absDir, clean, files);
  }
  return files;
}

async function walk(dir, rel, out) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, path.join(rel, e.name), out);
    else if (/\.(md|txt)$/i.test(e.name)) {
      out.push({ relPath: path.join("library", rel, e.name), absPath: full });
    }
  }
}

/** Baca semua file yang terhubung, digabung dengan header per file. Batas total. */
export async function readConnectedKnowledge(skillName, maxTotalChars = 24_000) {
  const { use_knowledge, connections } = await getSkillConnections(skillName);
  if (!use_knowledge || !connections.length) {
    return { connected: false, content: "", files: [] };
  }

  const files = await resolveKnowledgePaths(connections);
  if (!files.length) {
    return { connected: true, content: "", files: [], missing: connections };
  }

  let content = "";
  const used = [];
  for (const f of files) {
    if (content.length >= maxTotalChars) break;
    try {
      const text = await fs.readFile(f.absPath, "utf8");
      const slice = text.slice(0, maxTotalChars - content.length);
      content += `\n───── ${f.relPath} ─────\n${slice}\n`;
      used.push(f.relPath);
    } catch {}
  }
  return { connected: true, content: content.trim(), files: used };
}
