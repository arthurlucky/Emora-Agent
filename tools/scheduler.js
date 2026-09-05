import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { eventBus } from "../utils/eventBus.js";
import fs from "fs";
import path from "path";

const MEMORY_DIR = process.env.EMORA_MEMORY_DIR || path.resolve("./memory");
const JOBS_FILE = process.env.EMORA_CRON_FILE || path.join(MEMORY_DIR, "scheduler_jobs.json");

const activeJobs = {};

// ── Persistence helpers ──────────────────────────────────────────────
function loadPersistedJobs() {
  try {
    if (!fs.existsSync(JOBS_FILE)) return {};
    return JSON.parse(fs.readFileSync(JOBS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function persistJobs() {
  try {
    if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
    const data = {};
    for (const [id, job] of Object.entries(activeJobs)) {
      data[id] = {
        job_id: id,
        session_id: job.session_id,
        interval_seconds: job.interval_seconds,
        remainingCount: job.remainingCount,
        prompt: job.prompt,
        createdAt: job.createdAt,
      };
    }
    fs.writeFileSync(JOBS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`[SCHEDULER] Gagal persist jobs: ${err.message}`);
  }
}

function removePersistedJob(jobId) {
  try {
    const data = loadPersistedJobs();
    delete data[jobId];
    fs.writeFileSync(JOBS_FILE, JSON.stringify(data, null, 2));
  } catch {}
}

// ── Core scheduling logic ────────────────────────────────────────────
function scheduleJob(job_id, session_id, interval_seconds, count, prompt) {
  const sec = Math.max(interval_seconds || 10, 10);
  let remainingCount = count;

  const intervalTimer = setInterval(() => {
    eventBus.emit("execute_bg_task", { job_id, session_id, prompt });
    remainingCount--;
    activeJobs[job_id].remainingCount = remainingCount;
    persistJobs();

    if (remainingCount <= 0) {
      clearInterval(intervalTimer);
      delete activeJobs[job_id];
      removePersistedJob(job_id);
      console.log(`[SCHEDULER] Job '${job_id}' otomatis berhenti (Count habis).`);
    }
  }, sec * 1000);

  activeJobs[job_id] = {
    interval: intervalTimer,
    session_id,
    interval_seconds: sec,
    remainingCount,
    prompt,
    createdAt: Date.now(),
  };

  persistJobs();
  return sec;
}

// ── Recovery: re-schedule persisted jobs on startup ──────────────────
try {
  const saved = loadPersistedJobs();
  let recovered = 0;
  for (const [id, job] of Object.entries(saved)) {
    if (job.remainingCount > 0 && !activeJobs[id]) {
      scheduleJob(id, job.session_id, job.interval_seconds, job.remainingCount, job.prompt);
      recovered++;
    }
  }
  if (recovered > 0) console.log(`[SCHEDULER] ♻️ Recovered ${recovered} persisted job(s).`);
} catch (err) {
  console.error(`[SCHEDULER] Recovery gagal: ${err.message}`);
}

export const schedulerTool = new DynamicStructuredTool({
  name: "scheduler",
  description: "Menjalankan tugas AI di latar belakang secara berulang (interval timer). Sangat cocok untuk monitoring file atau peringatan. WAJIB gunakan DETIK. Memiliki batas eksekusi (count) agar tidak spam. Jobs PERSISTENT — bertahan setelah restart.",
  schema: z.object({
    action: z.enum(["start_job", "stop_job", "list_jobs"]),
    job_id: z.string().describe("ID unik tanpa spasi, misal: 'monitor_workspaces'"),
    session_id: z.string().describe("Session ID milik user").optional(),
    interval_seconds: z.number().optional().describe("Berapa detik sekali tugas dieksekusi? (Minimal 10 detik agar aman)"),
    count: z.number().optional().describe("Jumlah maksimal tugas dieksekusi. Default: 1. Jika mencapai 0, job otomatis dihapus."),
    prompt: z.string().optional().describe("Instruksi tugas. Akhiri dengan: 'Jika kondisi tidak terpenuhi, balas HANYA dengan kata SILENT_ABORT'")
  }),
  async func({ action, job_id, session_id, interval_seconds, count = 1, prompt }) {
    if (action === "list_jobs") {
      const entries = Object.entries(activeJobs);
      if (entries.length === 0) return "📋 Tidak ada job yang aktif.";
      const lines = entries.map(([id, j]) =>
        `• **${id}** — tiap ${j.interval_seconds}s, sisa ${j.remainingCount}x, sejak ${new Date(j.createdAt).toLocaleString()}`
      );
      return `📋 **${entries.length} Job Aktif:**\n${lines.join("\n")}`;
    }

    if (action === "stop_job") {
      if (!activeJobs[job_id]) return `❌ Job '${job_id}' tidak ditemukan atau sudah mati.`;
      clearInterval(activeJobs[job_id].interval);
      delete activeJobs[job_id];
      removePersistedJob(job_id);
      return `✅ Job '${job_id}' berhasil dimatikan secara manual.`;
    }

    if (activeJobs[job_id]) return `❌ Job '${job_id}' sudah berjalan. Matikan dulu jika ingin mengganti.`;
    if (!session_id) return `❌ Parameter session_id wajib diisi untuk start_job.`;

    const sec = scheduleJob(job_id, session_id, interval_seconds, count, prompt);
    return `✅ Job monitoring '${job_id}' berjalan tiap ${sec} detik. (Maksimal eksekusi: ${count} kali). Jobs PERSISTENT — akan otomatis dilanjutkan setelah restart.`;
  }
});
