/**
 * core/botRegistry.js
 *
 * Sistem Bot & Organisasi Perusahaan EMORA — Pecahan Agent Spesialis.
 * Setiap bot memiliki ID, Nama, Peran (System Prompt), Warna (Coloris),
 * serta daftar Skill & Tools yang dapat diakses. Bot dapat digabungkan ke
 * dalam Grup/Departemen dan saling mendelegasikan tugas layaknya perusahaan.
 */

import fs from "fs/promises";
import fssync from "fs";
import path from "path";
import chalk from "chalk";

const BOTS_FILE = ".emora/bots.json";

// Default Built-in Enterprise Bots
const DEFAULT_BOTS = {
  devbot: {
    id: "devbot",
    name: "DevBot",
    role: "Senior Software Engineer & Fullstack Developer. Fokus pada penulisan kode bersih, refactoring, dan implementasi fitur.",
    color: "#58a6ff", // Cyan
    tools: ["read_file", "write_file", "patch", "shell_exec", "verify"],
    skills: ["code-simplification", "test-driven-development"],
    createdAt: new Date().toISOString(),
  },
  qabot: {
    id: "qabot",
    name: "QABot",
    role: "Quality Assurance & Security Auditor. Memeriksa kebenaran kode, menangkap edge-case error, dan melakukan audit keamanan.",
    color: "#3fb950", // Green
    tools: ["read_file", "verify", "shell_exec"],
    skills: ["code-review-and-quality", "security-and-hardening"],
    createdAt: new Date().toISOString(),
  },
  researchbot: {
    id: "researchbot",
    name: "ResearchBot",
    role: "Web & Codebase Researcher. Mencari informasi, membaca dokumentasi, dan merangkum analisis mendalam.",
    color: "#a371f7", // Purple
    tools: ["search_web", "fetch_page", "search_text", "read_file"],
    skills: ["source-driven-development", "context-engineering"],
    createdAt: new Date().toISOString(),
  },
  archbot: {
    id: "archbot",
    name: "ArchBot",
    role: "System Architect & Lead Coordinator. Merancang arsitektur modul, membagi task besar, dan mengoordinasikan tim bot.",
    color: "#d29922", // Gold / Yellow
    tools: ["project_manager", "swarm_delegate", "artifact_tool"],
    skills: ["api-and-interface-design", "planning-and-task-breakdown"],
    createdAt: new Date().toISOString(),
  },
};

const DEFAULT_GROUPS = {
  engineering: {
    id: "engineering",
    name: "Engineering Department",
    description: "Departemen Pengembangan & QA Software",
    leaderBotId: "archbot",
    botIds: ["archbot", "devbot", "qabot", "researchbot"],
    createdAt: new Date().toISOString(),
  },
};

async function load() {
  try {
    if (!fssync.existsSync(BOTS_FILE)) {
      return { bots: { ...DEFAULT_BOTS }, groups: { ...DEFAULT_GROUPS } };
    }
    const raw = JSON.parse(await fs.readFile(BOTS_FILE, "utf8"));
    return {
      bots: { ...DEFAULT_BOTS, ...(raw.bots || {}) },
      groups: { ...DEFAULT_GROUPS, ...(raw.groups || {}) },
    };
  } catch {
    return { bots: { ...DEFAULT_BOTS }, groups: { ...DEFAULT_GROUPS } };
  }
}

async function save(data) {
  await fs.mkdir(".emora", { recursive: true });
  await fs.writeFile(BOTS_FILE, JSON.stringify(data, null, 2), "utf8");
}

export async function listBots() {
  const data = await load();
  return Object.values(data.bots);
}

export async function getBot(idOrName) {
  const data = await load();
  const key = String(idOrName).toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return data.bots[key] || Object.values(data.bots).find(b => b.name.toLowerCase() === key) || null;
}

export async function registerBot({ name, role, color = "#58a6ff", tools = [], skills = [] }) {
  if (!name || !role) throw new Error("Nama dan Peran bot wajib diisi.");
  const id = name.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const data = await load();

  data.bots[id] = {
    id,
    name: name.trim(),
    role: role.trim(),
    color: color.trim() || "#58a6ff",
    tools: Array.isArray(tools) ? tools : [],
    skills: Array.isArray(skills) ? skills : [],
    createdAt: new Date().toISOString(),
  };

  await save(data);
  return data.bots[id];
}

export async function removeBot(idOrName) {
  const data = await load();
  const bot = await getBot(idOrName);
  if (!bot) throw new Error(`Bot "${idOrName}" tidak ditemukan.`);

  delete data.bots[bot.id];

  // Hapus bot dari semua grup
  for (const g of Object.values(data.groups)) {
    g.botIds = g.botIds.filter(bId => bId !== bot.id);
  }

  await save(data);
  return true;
}

export async function listGroups() {
  const data = await load();
  return Object.values(data.groups);
}

export async function getGroup(idOrName) {
  const data = await load();
  const key = String(idOrName).toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return data.groups[key] || Object.values(data.groups).find(g => g.name.toLowerCase() === key) || null;
}

export async function createGroup({ name, description = "", leaderBotId = null, botIds = [] }) {
  if (!name) throw new Error("Nama grup bot wajib diisi.");
  const id = name.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const data = await load();

  data.groups[id] = {
    id,
    name: name.trim(),
    description: description.trim(),
    leaderBotId: leaderBotId || (botIds[0] || null),
    botIds: Array.from(new Set(botIds)),
    createdAt: new Date().toISOString(),
  };

  await save(data);
  return data.groups[id];
}

export function formatBotBadge(bot) {
  const colorFn = chalk.hex(bot.color || "#58a6ff").bold;
  return colorFn(`[🤖 ${bot.name} | ${bot.role.slice(0, 35)}...]`);
}

export default {
  listBots,
  getBot,
  registerBot,
  removeBot,
  listGroups,
  getGroup,
  createGroup,
  formatBotBadge,
};
