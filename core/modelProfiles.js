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
  if (!name || typeof name !== "string" || !name.trim()) throw new Error("Nama profile tidak boleh kosong.");
  const profileKey = name.trim();
  const data = await load();
  data.profiles[profileKey] = {
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
      name: profileKey,
      url: process.env.MODEL_URL,
      apiKey: process.env.MODEL_API || "",
      models: [process.env.MODEL_NAME].filter(Boolean),
    });
  }
  return data.profiles[profileKey];
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
export async function fetchCustomModels(url, apiKey = "", compat = "auto") {
  if (!url) return [];
  const cleanUrl = url.trim().replace(/\/$/, "");
  const baseOrigin = cleanUrl.replace(/\/v1\/?$/, "").replace(/\/api\/?$/, "");

  // Multi-protocol candidate probe endpoints (OpenAI, Ollama, Anthropic, Groq, Gemini)
  const endpoints = [
    { url: `${cleanUrl}/models`, headers: apiKey ? { Authorization: `Bearer ${apiKey}`, "x-api-key": apiKey } : {} },
    { url: `${baseOrigin}/v1/models`, headers: apiKey ? { Authorization: `Bearer ${apiKey}`, "x-api-key": apiKey, "anthropic-version": "2023-06-01" } : {} },
    { url: `${baseOrigin}/api/tags` },
    { url: `${baseOrigin}/api/models` },
    { url: `${baseOrigin}/v1beta/models?key=${apiKey}` },
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, {
        headers: ep.headers || {},
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) continue;

      const json = await res.json();

      // Format 1: OpenAI / Groq / Anthropic ({ data: [ { id: "gpt-4" }, ... ] })
      if (json.data && Array.isArray(json.data)) {
        const found = json.data.map(m => ({
          id: String(m.id || m.name || ""),
          name: String(m.name || m.id || ""),
        })).filter(m => m.id);
        if (found.length > 0) return found;
      }

      // Format 2: Ollama native ({ models: [ { name: "llama3" }, ... ] })
      if (json.models && Array.isArray(json.models)) {
        const found = json.models.map(m => {
          const rawName = String(m.name || m.displayName || m.id || m.model || "");
          const cleanName = rawName.replace(/^models\//, "");
          return { id: cleanName, name: cleanName };
        }).filter(m => m.id);
        if (found.length > 0) return found;
      }

      // Format 3: Array of objects or strings directly ([ "llama3", ... ])
      if (Array.isArray(json)) {
        const found = json.map(m => ({
          id: typeof m === "string" ? m : String(m.id || m.name || m.model || ""),
          name: typeof m === "string" ? m : String(m.name || m.id || m.model || ""),
        })).filter(m => m.id);
        if (found.length > 0) return found;
      }
    } catch {
      // Probe next candidate endpoint
    }
  }

  return [];
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
