/**
 * core/agentMode.js
 *
 * Pilih AGENT.md (full) vs AGENT_LITE.md berdasarkan ukuran model.
 * Tidak terikat satu provider: parse nama model apa pun, cocok buat
 * openrouter / ollama / custom endpoint / model lokal.
 *
 * Logika "model kecil → LITE" ala Hermes:
 *   - konteks efektif ≤ 4k → LITE wajib
 *   - parameter ≤ 1.5B (270m, 350m, 1b, 1.5b) → LITE
 *   - nama mengandung mini/tiny/nano/8b-coder/... → LITE
 *   - konteks ≤ 16k → boleh LITE (rekomendasi)
 *   - selain itu → FULL
 */

const SMALL_TOKENS_THRESHOLD = 4096;        // wajib LITE
const LITE_RECOMMENDED_TOKENS = 16384;      // rekomendasi LITE

/** Parse jumlah parameter dari nama model. Return bilangan B atau null. */
export function parseModelSize(modelId) {
  if (!modelId) return null;
  const s = String(modelId).toLowerCase();
  // jutaan param: 270m, 350m, 0.5b, 1.1b
  const mMatch = s.match(/[-_:.](\d+(?:\.\d+)?)m\b/);
  if (mMatch) return parseFloat(mMatch[1]) / 1000;
  const bMatch = s.match(/[-_:.](\d+(?:\.\d+)?)b\b/);
  if (bMatch) return parseFloat(bMatch[1]);
  return null;
}

/** Parse konteks efektif (token) dari nama atau deskripsi model. */
export function parseContextTokens(modelId) {
  if (!modelId) return null;
  const s = String(modelId).toLowerCase();
  const kMatch = s.match(/[-_:](\d+)k(?!\w)/);
  if (kMatch) return parseInt(kMatch[1]) * 1024;
  const mMatch = s.match(/[-_:](\d+)m(?!\w)/);
  if (mMatch) return parseInt(mMatch[1]) * 1_000_000;
  return null;
}

/** True bila model dianggap kecil (≤1.5B, mini/tiny/nano, atau 270m/350m). */
export function isSmallModel(modelId) {
  if (!modelId) return false;
  const s = String(modelId).toLowerCase();
  if (/[-_:.](\d+)m\b/.test(s)) return true; // 270m, 350m → selalu kecil
  const b = parseModelSize(s);
  if (b != null && b <= 1.5) return true;
  return /mini|tiny|nano|small\b/.test(s);
}

/** Rekomendasi mode agent + alasannya. */
export function recommendAgentMode({ modelId, contextTokens = null } = {}) {
  const tokens = contextTokens ?? parseContextTokens(modelId);
  const size = parseModelSize(modelId);

  if (tokens != null && tokens <= SMALL_TOKENS_THRESHOLD) {
    return { mode: "lite", reason: `konteks ${tokens} ≤ ${SMALL_TOKENS_THRESHOLD} token` };
  }
  if (size != null && size <= 1.5) {
    return { mode: "lite", reason: `model ${size}B param ≤ 1.5B` };
  }
  if (isSmallModel(modelId)) {
    return { mode: "lite", reason: "nama model mengandung mini/tiny/nano" };
  }
  if (tokens != null && tokens <= LITE_RECOMMENDED_TOKENS) {
    return { mode: "lite", reason: `konteks ${tokens} ≤ ${LITE_RECOMMENDED_TOKENS} token (rekomendasi)` };
  }
  return { mode: "full", reason: size ? `${size}B model, konteks cukup` : "model cukup besar" };
}

/** Tentukan path AGENT file yang dipakai. */
export function resolveAgentPath({ rootDir, modelId, contextTokens, envOverride } = {}) {
  const override = (envOverride ?? process.env.AGENT_MODE ?? "").toLowerCase();
  const litePath = `${rootDir}/AGENT_LITE.md`;
  const fullPath = `${rootDir}/AGENT.md`;

  if (override === "lite") return { path: litePath, usedLite: true, reason: "AGENT_MODE=lite" };
  if (override === "full") return { path: fullPath, usedLite: false, reason: "AGENT_MODE=full" };

  const rec = recommendAgentMode({ modelId, contextTokens });
  return rec.mode === "lite"
    ? { path: litePath, usedLite: true, reason: rec.reason }
    : { path: fullPath, usedLite: false, reason: rec.reason };
}
