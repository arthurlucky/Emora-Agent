import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { eventBus } from "../utils/eventBus.js";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { logLine } from "../utils/logger.js";

const MEMORY_DIR = process.env.EMORA_MEMORY_DIR || path.resolve("./memory");
const JOBS_FILE = process.env.EMORA_CRON_FILE || path.join(MEMORY_DIR, "scheduler_jobs.json");
const MAX_JOBS = 20;
const MAX_PROMPT_CHARS = 4000;
const SAFE_JOB_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const activeJobs = {};

// ── Persistence helpers (async, debounced) ─────────────────────────────
let persistTimer = null;
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistJobsAsync().catch((e) => logLine("warn", `[SCHEDULER] persist gagal: ${e.message}`));
  }, 500);
}

async function persistJobsAsync() {
  try {
    await fsp.mkdir(MEMORY_DIR, { recursive: true });
    const data = {};
    for (const [id, job] of Object.entries(activeJobs)) {
      data[id] = {
        job_id: id,
        session_id: job.session_id,
        interval_seconds: job.interval_seconds,
        remainingCount: job.remainingCount,
        prompt: (job.prompt || "").slice(0, MAX_PROMPT_CHARS),
        createdAt: job.createdAt,
      };
    }
    const tmp = `${JOBS_FILE}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
    await fsp.rename(tmp, JOBS_FILE);
  } catch (err) {
    logLine("warn", `[SCHEDULER] Gagal persist jobs: ${err.message}`);
  }
}

function loadPersistedJobsSync() {
  // Sekali saat startup — boleh sync (bukan di render loop TUI).
  try {
    if (!fs.existsSync(JOBS_FILE)) return {};
    return JSON.parse(fs.readFileSync(JOBS_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function removePersistedJob(jobId) {
  try {
    const raw = await fsp.readFile(JOBS_FILE, "utf8").catch(() => "{}");
    const data = JSON.parse(raw);
    delete data[jobId];
    await fsp.writeFile(JOBS_FILE, JSON.stringify(data, null, 2));
  } catch { /* non-fatal */ }
}

// ── Core scheduling logic ────────────────────────────────────────────
function scheduleJob(job_id, session_id, interval_seconds, count, prompt) {
  const sec = Math.max(Math.min(interval_seconds || 10, 86400), 10);
  let remainingCount = Math.max(1, Math.min(count || 1, 1000));

  const intervalTimer = setInterval(() => {
    eventBus.emit("execute_bg_task", { job_id, session_id, prompt });
    remainingCount--;
    if (activeJobs[job_id]) activeJobs[job_id].remainingCount = remainingCount;
    schedulePersist();

    if (remainingCount <= 0) {
      clearInterval(intervalTimer);
      delete activeJobs[job_id];
      removePersistedJob(job_id);
      logLine("info", `[SCHEDULER] Job '${job_id}' otomatis berhenti (count habis).`);
    }
  }, sec * 1000);

  activeJobs[job_id] = {
    interval: intervalTimer,
    session_id,
    interval_seconds: sec,
    remainingCount,
    prompt: (prompt || "").slice(0, MAX_PROMPT_CHARS),
    createdAt: Date.now(),
  };

  schedulePersist();
  return sec;
}

// ── Recovery: re-schedule persisted jobs on startup ──────────────────
try {
  const saved = loadPersistedJobsSync();
  let recovered = 0;
  for (const [id, job] of Object.entries(saved)) {
    if (!SAFE_JOB_ID_RE.test(id)) continue;
    if (job.remainingCount > 0 && !activeJobs[id] && Object.keys(activeJobs).length < MAX_JOBS) {
      scheduleJob(id, job.session_id, job.interval_seconds, job.remainingCount, job.prompt);
      recovered++;
    }
  }
  if (recovered > 0) logLine("info", `[SCHEDULER] Recovered ${recovered} persisted job(s).`);
} catch (err) {
  logLine("warn", `[SCHEDULER] Recovery gagal: ${err.message}`);
}

export const schedulerTool = new DynamicStructuredTool({
  name: "scheduler",
  description: "Tugas AI latar belakang berulang (interval ≥10s, max 20 job). Persistent setelah restart. Wajib detik.",
  schema: z.object({
    action: z.enum(["start_job", "stop_job", "list_jobs"]),
    job_id: z.string().describe("ID unik [A-Za-z0-9_-] max 64, misal: 'monitor_workspaces'"),
    session_id: z.string().describe("Session ID milik user").optional(),
    interval_seconds: z.number().optional().describe("Detik tiap eksekusi (10-86400)"),
    count: z.number().optional().describe("Maks eksekusi (1-1000, default 1)"),
    prompt: z.string().optional().describe("Instruksi. Akhiri: 'Jika kondisi tidak terpenuhi, balas HANYA SILENT_ABORT'")
  }),
  async func({ action, job_id, session_id, interval_seconds, count = 1, prompt }) {
    if (action === "list_jobs") {
      const entries = Object.entries(activeJobs);
      if (entries.length === 0) return "📋 Tidak ada job yang aktif.";
      const lines = entries.map(([id, j]) =>
        `• **${id}** — tiap ${j.interval_seconds}s, sisa ${j.remainingCount}x, sejak ${new Date(j.createdAt).toLocaleString()}`
      );
      return `📋 **${entries.length}/${MAX_JOBS} Job Aktif:**\n${lines.join("\n")}`;
    }

    if (!SAFE_JOB_ID_RE.test(job_id || "")) {
      return `❌ job_id tidak valid: '${job_id}'. Gunakan huruf/angka/_/- saja (1-64 chars). Contoh: 'monitor_workspaces'.`;
    }

    if (action === "stop_job") {
      if (!activeJobs[job_id]) return `❌ Job '${job_id}' tidak ditemukan atau sudah mati. Cek list_jobs.`;
      clearInterval(activeJobs[job_id].interval);
      delete activeJobs[job_id];
      await removePersistedJob(job_id);
      return `✅ Job '${job_id}' dimatikan.`;
    }

    if (activeJobs[job_id]) return `❌ Job '${job_id}' sudah berjalan. stop_job dulu untuk mengganti.`;
    if (Object.keys(activeJobs).length >= MAX_JOBS) return `❌ Batas ${MAX_JOBS} job tercapai. stop_job yang lama dulu.`;
    if (!session_id) return `❌ session_id wajib untuk start_job.`;
    if (!prompt || !prompt.trim()) return `❌ prompt wajib untuk start_job.`;
    if (prompt.length > MAX_PROMPT_CHARS) return `❌ prompt >${MAX_PROMPT_CHARS} chars. Ringkas dulu.`;

    const sec = scheduleJob(job_id, session_id, interval_seconds, count, prompt);
    return `✅ Job '${job_id}' tiap ${sec}s (maks ${Math.min(count || 1, 1000)}x). Persistent — lanjut otomatis setelah restart.`;
  }
});
