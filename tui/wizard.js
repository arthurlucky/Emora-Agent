/**
 * tui/wizard.js
 *
 * Setup wizard (`/setup`) di dalam TUI. Berbeda dari versi Go (yang punya
 * daftar provider sendiri + GitHub OAuth device flow), di sini dipakai
 * daftar provider ASLI EMORA (provider/index.js) supaya hasilnya benar-benar
 * bisa dipakai createLLM() — bukan device-flow OAuth yang EMORA gak punya
 * infrastrukturnya.
 */
import { PROVIDERS, getProviderModels, getDefaultModel, getKeyUrl } from "../provider/index.js";
import { setEnv } from "./envHelpers.js";

export function providerChoices() {
  return Object.entries(PROVIDERS).map(([key, meta]) => ({
    value: key,
    label: `${meta.label}`,
    hint: meta.tier === "free" ? "gratis" : meta.tier === "paid" ? "berbayar" : "custom",
  }));
}

export function needsApiKey(providerKey) {
  return providerKey !== "ollama";
}

export function needsUrl(providerKey) {
  return providerKey === "custom" || providerKey === "ollama";
}

export function buildStepSequence(providerKey) {
  const seq = ["provider"];
  if (needsApiKey(providerKey)) seq.push("apiKey");
  if (needsUrl(providerKey)) seq.push("url");
  seq.push("model", "confirm");
  return seq;
}

export async function modelChoicesFor(providerKey) {
  const [models, def] = await Promise.all([getProviderModels(providerKey), getDefaultModel(providerKey)]);
  const choices = (models || []).map((m) => ({ value: m, label: m }));
  if (!choices.length && def) choices.push({ value: def, label: def + " (default)" });
  choices.push({ value: "__custom__", label: "Ketik manual..." });
  return { choices, defaultModel: def || "" };
}

export async function keyUrlFor(providerKey) {
  try { return await getKeyUrl(providerKey); } catch { return null; }
}

export function createWizardState() {
  return {
    sequence: ["provider"],
    stepIndex: 0,
    provider: null,
    apiKey: "",
    url: "",
    model: "",
    modelChoices: [],
    optionIndex: 0,
    textBuffer: "",
    keyUrl: null,
  };
}

export function currentStep(wizard) {
  return wizard.sequence[wizard.stepIndex];
}

export function applyWizardResult(wizard) {
  setEnv("MODEL_PROVIDER", wizard.provider);
  if (wizard.apiKey) setEnv("MODEL_API", wizard.apiKey);
  if (wizard.url) setEnv("MODEL_URL", wizard.url);
  if (wizard.model && wizard.model !== "__custom__") setEnv("MODEL_NAME", wizard.model);
}
