/**
 * core/linkBudget.js
 *
 * Guard context-window: kalau total karakter messages melewati 90% budget,
 * pangkas riwayat TERLAMA dulu (system message & pesan terakhir selamat).
 * Kalau masih over setelah semua riwayat dipangkas, hard-cap: sisakan
 * system + pesan terakhir saja.
 *
 * ponytail: hitung pakai char length (bukan token). Rasio ~4 char/token
 * cukup akurat untuk guard kasar. Upgrade: pakai tokenizer asli kalau
 * billing per-token jadi masalah.
 */
const KEEP_RATIO = 0.9;

export function enforceLinkBudget(messages, maxChars = 200_000) {
  const budget = Math.floor(maxChars * KEEP_RATIO);
  const total = messages.reduce((s, m) => s + (m.content?.length || 0), 0);

  if (total <= budget) return { messages, trimmed: false, dropped: 0 };

  const out = [...messages];
  let dropped = 0;

  // Pangkas riwayat terlama (index 1..n-2), sisakan system (0) & terakhir.
  while (out.length > 2 && out.reduce((s, m) => s + (m.content?.length || 0), 0) > budget) {
    out.splice(1, 1);
    dropped++;
  }

  // Hard cap: masih over → sisakan system + pesan terakhir.
  if (out.length > 2 && out.reduce((s, m) => s + (m.content?.length || 0), 0) > budget) {
    dropped += out.length - 2;
    return { messages: [out[0], out[out.length - 1]], trimmed: true, dropped };
  }

  return { messages: out, trimmed: true, dropped };
}
