/**
 * gateway/cron/schedule.js
 *
 * Ubah spec jadwal yang gampang ditulis manusia jadi ekspresi cron 5-field
 * standar yang dipahami `node-cron`. Menerima juga cron expression mentah
 * kalau user sudah tahu formatnya sendiri.
 *
 * Contoh input valid:
 *   "every 30m"        -> "*\/30 * * * *"
 *   "every 2h"         -> "0 *\/2 * * *"
 *   "daily at 9am"     -> "0 9 * * *"
 *   "daily at 17:30"   -> "30 17 * * *"
 *   "*\/15 * * * *"      -> dipakai apa adanya (sudah cron valid)
 */

const CRON_FIELD_RE = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/;

function isValidCronExpr(expr) {
  const t = expr.trim();
  if (!CRON_FIELD_RE.test(t)) return false;
  return t.split(/\s+/).every((f) => /^[\d*/,\-]+$/.test(f));
}

export function normalizeSchedule(spec) {
  if (!spec || typeof spec !== "string") {
    throw new Error("Jadwal tidak boleh kosong.");
  }
  const s = spec.trim().toLowerCase();

  // "every 30m" / "every 5 minutes" / "every 2h" / "every 1 hour" / "every 10s"
  let m = s.match(/^every\s+(\d+)\s*(m|min|minute|minutes|h|hour|hours|s|sec|second|seconds)?$/);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = (m[2] || "m")[0]; // huruf pertama: m / h / s
    if (n <= 0) throw new Error("Interval harus lebih besar dari 0.");

    if (unit === "h") {
      if (n >= 24) throw new Error("Interval jam maksimal 23 (pakai 'daily at ...' untuk siklus harian).");
      return `0 */${n} * * *`;
    }
    if (unit === "s") {
      if (n >= 60) throw new Error("Interval detik maksimal 59.");
      // node-cron mendukung field detik opsional di posisi paling depan
      return `*/${n} * * * * *`;
    }
    if (n >= 60) throw new Error("Interval menit maksimal 59 (pakai 'every Nh' untuk siklus jam).");
    return `*/${n} * * * *`;
  }

  // "daily at 9am" / "daily at 9:30am" / "daily at 17:00" / "daily at 5pm"
  m = s.match(/^daily\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (m) {
    let hour = parseInt(m[1], 10);
    const minute = m[2] ? parseInt(m[2], 10) : 0;
    const ampm = m[3];
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    if (hour < 0 || hour > 23) throw new Error("Jam tidak valid (0-23).");
    if (minute < 0 || minute > 59) throw new Error("Menit tidak valid (0-59).");
    return `${minute} ${hour} * * *`;
  }

  // Sudah berupa cron expression mentah
  if (isValidCronExpr(s)) return s;

  throw new Error(
    `Format jadwal tidak dikenali: "${spec}". Contoh valid: "every 30m", "every 2h", ` +
    `"daily at 9am", "daily at 17:30", atau cron expression 5-field ("*/15 * * * *").`
  );
}
