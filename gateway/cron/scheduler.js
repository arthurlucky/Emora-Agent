/**
 * gateway/cron/scheduler.js
 *
 * Menjadwalkan & menjalankan cron job lewat node-cron. Tiap job jalan
 * dengan memanggil agent EMORA (core/chat.js ask()) memakai prompt job,
 * lalu hasilnya dikirim balik ke chat asal lewat Manager.deliverMessage().
 *
 * Import core/chat.js, core/tools.js, provider/index.js sengaja LAZY
 * (di dalam _getDeps(), bukan top-level) — supaya sekadar meng-import
 * gateway/manager.js (dipakai juga oleh operasi ringan seperti
 * `emora gateway status`) gak ikut menyeret seluruh stack agent + MCP
 * bridge yang lumayan berat untuk di-load.
 */
import cron from "node-cron";

export class CronScheduler {
  constructor(store, manager) {
    this.store = store;
    this.manager = manager;
    this.tasks = new Map(); // job name -> node-cron task
    this._depsPromise = null;
    this._llmPromise = null;
  }

  async _getDeps() {
    if (!this._depsPromise) {
      this._depsPromise = Promise.all([
        import("../../core/chat.js"),
        import("../../core/tools.js"),
        import("../../provider/index.js"),
      ]).then(([chatMod, toolsMod, providerMod]) => ({
        ask: chatMod.ask,
        tools: toolsMod.default,
        createLLM: providerMod.createLLM,
      }));
    }
    return this._depsPromise;
  }

  /** Jalankan satu job sekarang juga (dipanggil scheduler atau `/cron run`). */
  async runJobNow(job) {
    try {
      const { ask, tools, createLLM } = await this._getDeps();
      if (!this._llmPromise) this._llmPromise = createLLM(tools);
      const llm = await this._llmPromise;
      const sessionId = `cron-${job.name}`;
      const result = await ask(llm, tools, sessionId, job.prompt);
      this.store.recordRun(job.name);

      const text = typeof result === "string" ? result : String(result?.content || result || "");
      if (text.trim()) {
        try {
          await this.manager.deliverMessage(job.platform, job.chatId, `⏰ *Hasil cron: ${job.name}*\n\n${text}`);
        } catch (err) {
          console.error(`[cron] Gagal kirim hasil job '${job.name}' ke ${job.platform}:`, err.message);
        }
      }
    } catch (err) {
      console.error(`[cron] Job '${job.name}' gagal jalan:`, err.message);
      try {
        await this.manager.deliverMessage(job.platform, job.chatId, `✘ Cron *${job.name}* gagal jalan: ${err.message}`);
      } catch { /* platform mungkin lagi mati, gapapa diskip */ }
    }
  }

  _unscheduleJob(name) {
    const task = this.tasks.get(name);
    if (task) {
      task.stop();
      this.tasks.delete(name);
    }
  }

  _scheduleJob(job) {
    this._unscheduleJob(job.name);
    if (!job.enabled) return;
    if (!cron.validate(job.schedule)) {
      console.warn(`[cron] Job '${job.name}' di-skip: jadwal tidak valid (${job.schedule})`);
      return;
    }
    const task = cron.schedule(job.schedule, () => {
      this.runJobNow(job).catch(() => {});
    });
    this.tasks.set(job.name, task);
  }

  /** Baca ulang semua job dari store & jadwalkan yang enabled. Panggil ini
   *  tiap kali job ditambah/diubah/dihapus lewat `/cron`. */
  reload() {
    for (const name of [...this.tasks.keys()]) this._unscheduleJob(name);
    for (const job of this.store.listJobs()) this._scheduleJob(job);
  }

  start() {
    this.reload();
  }

  stop() {
    for (const name of [...this.tasks.keys()]) this._unscheduleJob(name);
  }

  get activeCount() {
    return this.tasks.size;
  }
}
