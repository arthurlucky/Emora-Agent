// webui/src/format.js

export function formatClock(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

export function formatRelative(ts) {
  const d = new Date(ts).getTime();
  if (Number.isNaN(d)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - d) / 1000));

  if (diffSec < 30) return "baru saja";
  if (diffSec < 60) return `${diffSec}d lalu`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}j lalu`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}h lalu`;
  return new Date(ts).toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
}

export function shortId(id) {
  return id ? String(id).slice(0, 8) : "";
}
