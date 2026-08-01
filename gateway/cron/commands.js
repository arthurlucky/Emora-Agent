/**
 * gateway/cron/commands.js
 *
 * Handler untuk perintah `/cron ...` yang dipanggil dari Telegram/Discord/
 * WhatsApp. Mendukung syntax eksplisit (`/cron create "<jadwal>" "<prompt>"`)
 * maupun bahasa natural Indonesia ("jadwalin setiap jam 9 pagi cek website").
 */
import { normalizeSchedule } from "./schedule.js";

function parseQuotedArgs(text) {
  const res = [];
  let current = "";
  let inQuotes = false;
  let escaped = false;

  for (const ch of text) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      if (!inQuotes) {
        res.push(current);
        current = "";
      }
      continue;
    }
    if (ch === " " && !inQuotes) {
      if (current.length) {
        res.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current.length) res.push(current);
  return res;
}

function showCronHelp() {
  return [
    "⎔ *Perintah Cron Scheduler*",
    "",
    '`/cron create "<jadwal>" "<prompt>" [--name <nama>]`',
    '  Contoh: `/cron create "every 30m" "Cek status server"`',
    "`/cron list` — lihat semua job kamu",
    "`/cron enable <nama>` / `/cron disable <nama>`",
    "`/cron delete <nama>`",
    "`/cron run <nama>` — jalankan sekarang juga",
    "",
    "_Bisa juga pakai bahasa natural:_",
    '"jadwalin setiap jam 9 pagi cek website"',
    '"jadwalin tiap 30 menit cek email baru"',
  ].join("\n");
}

function digitsAtEnd(s) {
  const parts = s.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const last = parts[parts.length - 1];
  return (last.match(/\d+/g) || []).join("");
}

function extractDailyTime(rest) {
  const parts = rest.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { timePart: "", promptStartWord: "" };
  const first = parts[0];
  if (parts.length > 1) {
    const next = parts[1].toLowerCase();
    if (next === "pagi") return { timePart: first + "am", promptStartWord: parts[2] || "" };
    if (next === "malam" || next === "sore") return { timePart: first + "pm", promptStartWord: parts[2] || "" };
    if (next === "am" || next === "pm") return { timePart: first + next, promptStartWord: parts[2] || "" };
    return { timePart: first, promptStartWord: parts[1] };
  }
  return { timePart: first, promptStartWord: "" };
}

/** Coba parse perintah bahasa natural Indonesia jadi (schedule, prompt). */
function handleNaturalLanguage(store, platform, chatId, guildId, query) {
  let q = query.trim();
  let qLower = q.toLowerCase();

  const prefixes = ["jadwalin ", "buat cron ", "buat jadwal ", "schedule ", "tambahkan cron ", "tolong jadwalin "];
  for (const p of prefixes) {
    if (qLower.startsWith(p)) {
      q = q.slice(p.length);
      qLower = qLower.slice(p.length);
      break;
    }
  }

  let scheduleSpec = "";
  let prompt = "";
  let idx;

  if ((idx = qLower.search(/\bmenit\b/)) !== -1) {
    const digits = digitsAtEnd(qLower.slice(0, idx));
    if (digits) {
      scheduleSpec = `every ${digits}m`;
      prompt = q.slice(idx).replace(/^\S+\s*/, "").trim();
    }
  } else if ((idx = qLower.search(/\bjam\b/)) !== -1) {
    const digits = digitsAtEnd(qLower.slice(0, idx));
    if (digits) {
      scheduleSpec = `every ${digits}h`;
      prompt = q.slice(idx).replace(/^\S+\s*/, "").trim();
    } else {
      const rest = qLower.slice(idx + 3);
      const { timePart, promptStartWord } = extractDailyTime(rest);
      if (timePart) {
        try {
          scheduleSpec = "daily at " + timePart;
          const pIdx = promptStartWord ? qLower.indexOf(promptStartWord, idx) : -1;
          prompt = pIdx !== -1 ? q.slice(pIdx).trim() : "";
        } catch { /* fallthrough */ }
      }
    }
  } else if ((idx = qLower.search(/\b(tiap hari|setiap hari)\b/)) !== -1) {
    const afterKeyword = qLower.slice(idx).replace(/^(tiap hari|setiap hari)\s*/, "");
    const rest = afterKeyword.startsWith("jam ") ? afterKeyword.slice(4) : afterKeyword;
    const { timePart, promptStartWord } = extractDailyTime(rest);
    if (timePart) {
      scheduleSpec = "daily at " + timePart;
      const pIdx = promptStartWord ? qLower.indexOf(promptStartWord) : -1;
      prompt = pIdx !== -1 ? q.slice(pIdx).trim() : "";
    }
  }

  if (!scheduleSpec || !prompt) {
    return '✘ Gak bisa parse itu sebagai perintah cron. Pakai format eksplisit:\n`/cron create "<jadwal>" "<prompt>"`\natau `/cron` buat lihat bantuan.';
  }

  let normalized;
  try {
    normalized = normalizeSchedule(scheduleSpec);
  } catch (err) {
    return `✘ Gagal parse jadwal "${scheduleSpec}": ${err.message}`;
  }

  const name = `job-${Date.now() % 100000}`;
  try {
    store.saveJob({ name, schedule: normalized, prompt, platform, chatId, guildId: guildId || "", enabled: true });
  } catch (err) {
    return `✘ Gagal simpan job: ${err.message}`;
  }

  return `⎔ *Cron dibuat via bahasa natural!*\n• Nama: *${name}*\n• Jadwal: "${scheduleSpec}" (→ \`${normalized}\`)\n• Prompt: "${prompt}"`;
}

function handleCreate(store, platform, chatId, guildId, args) {
  const parts = parseQuotedArgs(args.join(" "));
  if (parts.length < 2) {
    return '✘ Syntax salah. Pakai: `/cron create "<jadwal>" "<prompt>" [--name <nama>]`';
  }

  const [scheduleSpec, prompt, ...rest] = parts;

  let normalized;
  try {
    normalized = normalizeSchedule(scheduleSpec);
  } catch (err) {
    return `✘ Jadwal "${scheduleSpec}" tidak valid: ${err.message}`;
  }

  let name = "";
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--name" && rest[i + 1]) { name = rest[i + 1]; break; }
  }
  if (!name) name = `job-${Date.now() % 100000}`;

  try {
    store.saveJob({ name, schedule: normalized, prompt, platform, chatId, guildId: guildId || "", enabled: true });
  } catch (err) {
    return `✘ Gagal simpan job: ${err.message}`;
  }

  return `✔ Cron job *${name}* berhasil dibuat.\n• Jadwal: "${scheduleSpec}" (→ \`${normalized}\`)\n• Prompt: "${prompt}"`;
}

function handleList(store, chatId) {
  const jobs = store.listJobs().filter((j) => j.chatId === chatId);
  if (!jobs.length) return "ℹ Belum ada cron job. Buat dengan `/cron create \"...\" \"...\"`.";

  const lines = ["⎔ *Cron Job Kamu:*"];
  for (const j of jobs) {
    const status = j.enabled ? "✔ aktif" : "✘ nonaktif";
    const lastRun = j.lastRun ? new Date(j.lastRun).toLocaleString("id-ID") : "belum pernah";
    lines.push(`\n• *${j.name}* (${status})\n  Jadwal: \`${j.schedule}\`\n  Prompt: "${j.prompt}"\n  Terakhir jalan: ${lastRun} · ${j.runCount || 0}x`);
  }
  return lines.join("\n");
}

/**
 * @param {import('./store.js').CronStore} store
 * @param {string} platform
 * @param {string} chatId
 * @param {string} guildId
 * @param {string[]} args   - argumen setelah "/cron"
 * @param {{runNow?: (job:object)=>Promise<void>, reload?: ()=>void}} hooks
 */
export function handleCronCommand(store, platform, chatId, guildId, args, hooks = {}) {
  const { runNow, reload } = hooks;

  if (!args || args.length === 0) return showCronHelp();

  const sub = args[0].toLowerCase();
  let out;

  switch (sub) {
    case "create":
      out = handleCreate(store, platform, chatId, guildId, args.slice(1));
      reload?.();
      return out;

    case "list":
      return handleList(store, chatId);

    case "delete": {
      if (args.length < 2) return "✘ Sebutkan nama job. Contoh: `/cron delete job-123`";
      const name = args[1];
      try {
        store.deleteJob(name);
        reload?.();
        return `✔ Job *${name}* dihapus.`;
      } catch (err) {
        return `✘ ${err.message}`;
      }
    }

    case "enable":
    case "disable": {
      if (args.length < 2) return `✘ Sebutkan nama job. Contoh: \`/cron ${sub} job-123\``;
      const name = args[1];
      try {
        const job = store.getJob(name);
        job.enabled = sub === "enable";
        store.saveJob(job);
        reload?.();
        return `✔ Job *${name}* ${job.enabled ? "diaktifkan" : "dinonaktifkan"}.`;
      } catch (err) {
        return `✘ ${err.message}`;
      }
    }

    case "run": {
      if (args.length < 2) return "✘ Sebutkan nama job. Contoh: `/cron run job-123`";
      const name = args[1];
      try {
        const job = store.getJob(name);
        runNow?.(job);
        return `✦ Job *${name}* dipicu, hasilnya bakal dikirim ke sini sebentar lagi.`;
      } catch (err) {
        return `✘ ${err.message}`;
      }
    }

    case "help":
      return showCronHelp();

    default:
      return handleNaturalLanguage(store, platform, chatId, guildId, args.join(" "));
  }
}
