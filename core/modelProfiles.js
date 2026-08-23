/**
 * core/modelProfiles.js
 *
 * Penyimpanan banyak konfigurasi model (profiles). Disimpan di
 * .emora/models.json. Satu profile = { provider, apiKey?, url?, model }.
 * Aktif = MODEL_PROVIDER/MODEL_API/MODEL_URL/MODEL_NAME di .env.
 *
 * CLI:  emora model save <nama> | emora model use <nama> | emora model rm <nama> | emora model list
 * TUI:  /switch <nama> langsung pindah; /switch tanpa arg → wizard.
 */
import fs from "fs/promises";
import fsSync from "fs";

const PROFILES_FILE = ".emora/models.json";

async function load() {
  try {
    const raw = JSON.parse(await fs.readFile(PROFILES_FILE, "utf8"));
    return typeof raw === "object" && raw ? raw : {};
  } catch {
    return {};
  }
}

async function save(profiles) {
  await fs.mkdir(".emora", { recursive: true });
  await fs.writeFile(PROFILES_FILE, JSON.stringify(profiles, null, 2));
}

export async function listProfiles() {
  return load();
}

/** Simpan konfigurasi .env AKTIF saat ini sebagai profile bernama. */
export async function saveProfile(name) {
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error("Nama profile tidak valid (huruf/angka/-/_).");
  const profiles = await load();
  profiles[name] = {
    provider: process.env.MODEL_PROVIDER || "",
    apiKey: process.env.MODEL_API || "",
    url: process.env.MODEL_URL || "",
    model: process.env.MODEL_NAME || "",
    savedAt: new Date().toISOString(),
  };
  await save(profiles);
  return profiles[name];
}

/**
 * Terapkan profile: tulis ke .env + proses.env (runtime langsung ganti).
 * Kembalikan config yang dipakai.
 */
export async function useProfile(name, setEnvFn) {
  const profiles = await load();
  const p = profiles[name];
  if (!p) throw new Error(`Profile "${name}" tidak ada. Tersimpan: ${Object.keys(profiles).join(", ") || "(kosong)"}`);

  const apply = setEnvFn || ((k, v) => { process.env[k] = v; });
  apply("MODEL_PROVIDER", p.provider);
  if (p.apiKey) apply("MODEL_API", p.apiKey); else apply("MODEL_API", "");
  apply("MODEL_URL", p.url || "");
  apply("MODEL_NAME", p.model);
  return p;
}

export async function removeProfile(name) {
  const profiles = await load();
  if (!profiles[name]) throw new Error(`Profile "${name}" tidak ada.`);
  delete profiles[name];
  await save(profiles);
}

/** Ringkasan untuk display: nama → provider/model. */
export function formatList(profiles) {
  const names = Object.keys(profiles);
  if (!names.length) return "(belum ada profile tersimpan — simpan dengan `emora model save <nama>`)";
  return names.map((n) => {
    const p = profiles[n];
    const active = p.provider === process.env.MODEL_PROVIDER && p.model === process.env.MODEL_NAME;
    return `${active ? "●" : " "} ${n.padEnd(16)} ${p.provider}/${p.model}`;
  }).join("\n");
}
