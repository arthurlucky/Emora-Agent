/**
 * gateway/cron/store.js
 *
 * Penyimpanan job cron sebagai satu file JSON di dalam project
 * (gateway/cron/jobs.json), konsisten dengan pola penyimpanan JSON EMORA
 * lainnya (memory/*.json, core/sessionStore.js, dll).
 */
import fs from "fs";
import path from "path";

const JOBS_FILE = process.env.EMORA_CRON_FILE ? path.resolve(process.env.EMORA_CRON_FILE) : path.resolve("./gateway/cron/jobs.json");

function readAll() {
  try {
    const raw = fs.readFileSync(JOBS_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeAll(jobs) {
  fs.mkdirSync(path.dirname(JOBS_FILE), { recursive: true });
  fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
}

/**
 * @typedef {Object} CronJob
 * @property {string} name
 * @property {string} schedule     - cron expression 5 (atau 6) field
 * @property {string} prompt       - prompt yang dikirim ke agent tiap job jalan
 * @property {string} platform     - "telegram" | "whatsapp" | "discord"
 * @property {string} chatId
 * @property {string} [guildId]
 * @property {boolean} enabled
 * @property {string|null} lastRun - ISO timestamp
 * @property {number} runCount
 */
export class CronStore {
  listJobs() {
    return readAll();
  }

  listJobsForChat(platform, chatId) {
    return readAll().filter((j) => j.platform === platform && j.chatId === chatId);
  }

  getJob(name) {
    const job = readAll().find((j) => j.name === name);
    if (!job) throw new Error(`Job '${name}' tidak ditemukan.`);
    return job;
  }

  saveJob(job) {
    if (!job?.name) throw new Error("Job harus punya 'name'.");
    const jobs = readAll();
    const idx = jobs.findIndex((j) => j.name === job.name);
    if (idx >= 0) {
      jobs[idx] = { ...jobs[idx], ...job };
    } else {
      jobs.push({ lastRun: null, runCount: 0, ...job });
    }
    writeAll(jobs);
    return this.getJob(job.name);
  }

  deleteJob(name) {
    const jobs = readAll();
    const next = jobs.filter((j) => j.name !== name);
    if (next.length === jobs.length) throw new Error(`Job '${name}' tidak ditemukan.`);
    writeAll(next);
  }

  recordRun(name) {
    const jobs = readAll();
    const idx = jobs.findIndex((j) => j.name === name);
    if (idx >= 0) {
      jobs[idx].lastRun = new Date().toISOString();
      jobs[idx].runCount = (jobs[idx].runCount || 0) + 1;
      writeAll(jobs);
    }
  }
}
