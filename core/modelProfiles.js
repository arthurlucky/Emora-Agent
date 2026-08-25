/**
 * core/modelProfiles.js
 *
 * Registry provider + model yang pernah di-setup. Disimpan .emora/models.json:
 *
 *   profiles: { <nama>: {provider, apiKey, url, model, compat, savedAt} }
 *   customEndpoints: { <nama>: {url, apiKey, compat, models:[], savedAt} }
 *
 * compat = jenis API compatibility untuk custom endpoint:
 *   "openai" (default) | "anthropic" | "gemini" | "ollama"
 * Dipakai untuk memilih cara fetchModels & createLLM tanpa re-setup.
 */
import fs from "fs/promises";
import fsSync from "fs";

const PROFILES_FILE = ".emora/models.json";

async function load() {
  try {
    const raw = JSON.parse(await fs.readFile(PROFILES_FILE, "utf8"));
    if (Array.isArray(raw)) return { profiles: {}, customEndpoints: {} }; // format lama
    return {
      profiles: raw.profiles || {},
      customEndpoints: raw.customEndpoints || {},
    };
  } catch {
    return { profiles: {}, customEndpoints: {} };
  }
}

async function save(data) {
  await fs.mkdir(".emora", { recursive: true });
  await fs.writeFile(PROFILES_FILE, JSON.stringify(data, null, 2));
}

// ── Profiles (config lengkap siap pakai) ─────────────────────────────────────

export async function listProfiles() {
  return (await load()).profiles;
}

/** Simpan config .env aktif sebagai profile. Auto-dipanggil oleh emora setup model. */
export async function saveProfile(name) {
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error("Nama profile tidak valid (huruf/angka/-/_).");
  const data = await load();
  data.profiles[name] = {
    provider: process.env.MODEL_PROVIDER || "",
    apiKey: process.env.MODEL_API || "",
    url: process.env.MODEL_URL || "",
    model: process.env.MODEL_NAME || "",
    compat: process.env.MODEL_COMPAT || detectCompat(process.env.MODEL_URL || ""),
    savedAt: new Date().toISOString(),
  };
  await save(data);
  // Juga daftarkan sebagai custom endpoint bila provider=custom.
  if ((process.env.MODEL_PROVIDER || "") === "custom" && process.env.MODEL_URL) {
    await addCustomEndpoint({
      name,
      url: process.env.MODEL_URL,
      apiKey: process.env.MODEL_API || "",
      models: [process.env.MODEL_NAME].filter(Boolean),
    });
  }
  return data.profiles[name];
}

export async function useProfile(name, setEnvFn) {
  const data = await load();
  const p = data.profiles[name];
  if (!p) throw new Error(`Profile "${name}" tidak ada. Tersimpan: ${Object.keys(data.profiles).join(", ") || "(kosong)"}`);

  const apply = setEnvFn || ((k, v) => { process.env[k] = v; });
  apply("MODEL_PROVIDER", p.provider);
  apply("MODEL_API", p.apiKey || "");
  apply("MODEL_URL", p.url || "");
  apply("MODEL_NAME", p.model);
  if (p.compat) apply("MODEL_COMPAT", p.compat); else apply("MODEL_COMPAT", "");
  return p;
}

export async function removeProfile(name) {
  const data = await load();
  if (!data.profiles[name]) throw new Error(`Profile "${name}" tidak ada.`);
  delete data.profiles[name];
  await save(data);
}

// ── Custom endpoints (URL+key yang pernah ditambahkan — reuse tanpa re-setup) ─

export async function listCustomEndpoints() {
  return (await load()).customEndpoints;
}

export async function addCustomEndpoint({ name, url, apiKey = "", compat = "openai", models = [] }) {
  if (!name || !url) throw new Error("addCustomEndpoint butuh name & url.");
  const data = await load();
  const existing = data.customEndpoints[name];
  data.customEndpoints[name] = {
    url,
    apiKey,
    compat,
    // merge model list — tiap penambahan menambah pilihan berikutnya.
    models: [...new Set([...(existing?.models || []), ...models])],
    savedAt: new Date().toISOString(),
  };
  await save(data);
  return data.customEndpoints[name];
}

export async function removeCustomEndpoint(name) {
  const data = await load();
  if (!data.customEndpoints[name]) throw new Error(`Custom endpoint "${name}" tidak ada.`);
  delete data.customEndpoints[name];
  await save(data);
}

export async function getCustomEndpoint(name) {
  return (await load()).customEndpoints[name] || null;
}

// ── Compatibility detection (aturan user: auto detect compatible API) ────────

/** Deteksi jenis compat dari URL — dipakai saat user tidak menyebut manual. */
export function detectCompat(url = "") {
  const u = url.toLowerCase();
  if (u.includes("anthropic.com")) return "anthropic";
  if (u.includes("generativelanguage.googleapis.com")) return "gemini";
  if (u.includes(":11434") || u.includes("ollama")) return "ollama";
  // Default mayoritas server (LM Studio, vLLM, LocalAI, Together, Fireworks,
  // OpenRouter, Groq, DeepSeek, dst semua OpenAI-compatible).
  return "openai";
}

export const COMPAT_TYPES = [
  { id: "openai",    label: "OpenAI-compatible   (LM Studio, vLLM, LocalAI, Together, Fireworks, dll)" },
  { id: "anthropic", label: "Anthropic-compatible (/v1/messages format)" },
  { id: "gemini",    label: "Google Gemini-compatible (generateContent)" },
  { id: "ollama",    label: "Ollama-native (/api/chat)" },
];

// ── Realtime models dari custom endpoint (GET /models — OpenAI-compat) ────────

/** Ambil daftar model LIVE dari sebuah URL. Mendukung openai & ollama format.
 *  anthropic/gemini tak punya /models publik → return []. */
export async function fetchCustomModels(url, apiKey = "", compat = "openai") {
  if (!url) return [];
  try {
    if (compat === "ollama") {
      const base = url.replace(/\/v1\/?$/, "");
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return [];
      const json = await res.json();
      return (json.models || []).map(m => ({ id: m.name, name: m.name }));
    }
    // openai-compat: GET {url}/models
    const base = url.replace(/\/$/, "");
    const res = await fetch(`${base}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data || []).map(m => ({ id: m.id, name: m.id }));
  } catch {
    return [];
  }
}

// ── Display ───────────────────────────────────────────────────────────────────

export function formatList(profiles) {
  const names = Object.keys(profiles);
  if (!names.length) return "(belum ada profile tersimpan)";
  return names.map((n) => {
    const p = profiles[n];
    const active = p.provider === process.env.MODEL_PROVIDER && p.model === process.env.MODEL_NAME;
    return `${active ? "●" : " "} ${n.padEnd(16)} ${p.provider}/${p.model}`;
  }).join("\n");
}
