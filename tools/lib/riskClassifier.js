/**
 * tools/lib/riskClassifier.js
 *
 * Klasifikasi risiko perintah shell — dipakai oleh tools/bash.js.
 * Dipisah jadi modul sendiri (murni logic, tanpa import child_process/
 * gateway/dll) supaya gampang di-unit-test dan bisa dipakai ulang oleh
 * tool lain yang juga menjalankan perintah shell (mis. git_manager.js).
 *
 * Lihat tools/bash.js untuk penjelasan lengkap kenapa ini rewrite dari
 * BLACKLIST tunggal sebelumnya, dan kenapa ini TETAP BUKAN sandbox
 * sungguhan (filter di level aplikasi, bukan isolasi proses/container).
 */

const HIGH_RISK_PATTERNS = [
  { re: /\(\)\s*\{[^}]*\|[^}]*&[^}]*\}\s*;/, reason: "fork bomb (fungsi yang memanggil dirinya sendiri di background, dipipe)" },
  { re: /\bmkfs\./, reason: "format filesystem" },
  { re: /\bdd\s+if=.*of=\/dev\//, reason: "raw write ke block device" },
  { re: />\s*\/dev\/sd[a-z]/, reason: "raw write ke block device" },
  { re: /\bshutdown\b/, reason: "shutdown sistem" },
  { re: /\breboot\b/, reason: "reboot sistem" },
  { re: /\bhalt\b/, reason: "halt sistem" },
  { re: /\bpoweroff\b/, reason: "poweroff sistem" },
  { re: /\brm\s+-[a-z-]*[rf][a-z-]*[rf]?[a-z-]*\s+\/(?!\S)/, reason: "hapus rekursif seluruh root filesystem (/)" },
  { re: /\brm\s+-[a-z-]*[rf][a-z-]*[rf]?[a-z-]*\s+~\/?(?!\S)/, reason: "hapus rekursif seluruh home directory" },
];

const MEDIUM_RISK_PATTERNS = [
  { re: /\brm\s+-[a-z-]*[rf][a-z-]*[rf]?[a-z-]*\s+(\/etc|\/var|\/usr|\/bin|\/boot|\/lib|\/opt|\$HOME)(?!\S)/, reason: "hapus rekursif direktori sistem" },
  { re: /\brm\s+-[a-z-]*[rf][a-z-]*[rf]?[a-z-]*\s+(\*|\.)(?!\S)/, reason: "hapus rekursif semua isi direktori saat ini" },
  { re: /\bchmod\s+(-R\s+)?777\b/, reason: "ubah permission jadi 777 (world-writable)" },
  { re: /\bchown\s+-R\b.*\/(etc|var|usr|bin)\b/, reason: "ubah owner rekursif direktori sistem" },
  { re: /\b(curl|wget)\b.*\|\s*(sudo\s+)?(bash|sh|zsh|python3?)\b/, reason: "download lalu langsung dieksekusi (curl/wget | shell)" },
  { re: /\bbase64\s+(-d|--decode)\b.*\|\s*(bash|sh|zsh)\b/, reason: "decode base64 lalu langsung dieksekusi" },
  { re: /\beval\b/, reason: "eval — eksekusi string sebagai perintah" },
  { re: /\b(bash|sh|zsh)\s+-c\b/, reason: "eksekusi sub-shell dari string" },
  { re: /\bpython3?\s+-c\b/, reason: "eksekusi skrip python inline" },
  { re: /\bperl\s+-e\b/, reason: "eksekusi skrip perl inline" },
  { re: /\bruby\s+-e\b/, reason: "eksekusi skrip ruby inline" },
  { re: /\bgit\s+push\s+.*(-f\b|--force\b)/, reason: "force-push git (bisa menimpa history remote)" },
  { re: /\bsudo\s+su\b|\bsu\s+-\b/, reason: "eskalasi ke root" },
  { re: /\bcrontab\s+-r\b/, reason: "hapus semua cron job" },
  { re: /\biptables\s+-F\b/, reason: "flush semua firewall rule" },
  { re: /\bhistory\s+-c\b/, reason: "hapus history shell" },
  { re: /\bkill\s+-9\s+1\b/, reason: "kill proses init (PID 1)" },
  { re: /\bpasswd(?:\s|$)/, reason: "ubah password user" },
];

/** Normalisasi ringan sebelum diklasifikasi — menutup celah bypass paling
 *  sederhana (kutip di sekitar flag, whitespace berlebih). Bukan parser
 *  shell sungguhan, cuma pengetatan heuristik. */
function normalizeForRiskCheck(cmd) {
  return cmd
    .replace(/(["'])(-{1,2}[a-zA-Z-]+)\1/g, "$2") // "-rf" / '-rf' -> -rf
    .replace(/[ \t]+/g, " ");
}

export function classifyRisk(rawCmd) {
  const cmd = normalizeForRiskCheck(rawCmd);
  for (const { re, reason } of HIGH_RISK_PATTERNS) {
    if (re.test(cmd)) return { level: "high", reason };
  }
  for (const { re, reason } of MEDIUM_RISK_PATTERNS) {
    if (re.test(cmd)) return { level: "medium", reason };
  }
  return { level: "low", reason: null };
}
