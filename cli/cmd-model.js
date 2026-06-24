/**
 * cli/cmd-model.js — `emora model`
 * Ganti model/provider aktif secara interaktif, tanpa harus masuk ke setup penuh.
 */

import "dotenv/config";
import fs from "fs";
import ora from "ora";
import { select, input, sectionHeader, sectionFooter, successLine } from "./select.js";
import { PROVIDERS, getProviderModels } from "../provider/index.js";
import * as ollamaMod from "../provider/ollama/index.js";

const ENV_PATH = "./.env";
function getEnv(k) { const m = (fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH,"utf8") : "").match(new RegExp(`^${k}=(.*)$`,"m")); return m?m[1].trim():""; }
function setEnv(k,v) { let c=fs.existsSync(ENV_PATH)?fs.readFileSync(ENV_PATH,"utf8"):""; const re=new RegExp(`^${k}=.*$`,"m"); c=re.test(c)?c.replace(re,`${k}=${v}`):c+(c.endsWith("\n")||c===""?"":"\n")+`${k}=${v}`; fs.writeFileSync(ENV_PATH,c.trim()+"\n"); }

export async function cmdModel() {
  const curProvider = getEnv("MODEL_PROVIDER") || "ollama";
  const curModel    = getEnv("MODEL_NAME") || "—";

  sectionHeader("MODEL SELECTOR", `Aktif: ${curProvider}  /  ${curModel}`);

  const providerChoices = Object.entries(PROVIDERS).map(([key, meta]) => ({
    label: `${meta.label.padEnd(26)} [${meta.tier.toUpperCase()}]`,
    value: key,
  }));

  const newProvider = await select("Pilih provider:", providerChoices,
    { default: Math.max(0, providerChoices.findIndex(c => c.value === curProvider)) }
  );

  setEnv("MODEL_PROVIDER", newProvider);

  // Update BASE_URL otomatis dari provider module
  try {
    const mod = await import(`../provider/${newProvider === "custom" ? "customEndpoint" : newProvider}/index.js`);
    if (mod.BASE_URL && newProvider !== "ollama" && newProvider !== "custom") {
      setEnv("MODEL_URL", mod.BASE_URL);
    }
  } catch {}

  if (newProvider === "ollama") {
    const host = getEnv("MODEL_URL")?.replace("/v1","") || "http://localhost:11434";
    const spin = ora("  Scanning Ollama...").start();
    try {
      const models = await ollamaMod.scanModels();
      if (models.length) {
        spin.succeed(`Ditemukan ${models.length} model`);
        const m = await select("Pilih model:", models.map(m=>({label:m,value:m})));
        setEnv("MODEL_NAME", m);
      } else {
        spin.warn("Tidak ada model atau Ollama tidak bisa dijangkau.");
        const known = ollamaMod.KNOWN_MODELS.map(m => ({ label: m.label, value: m.id }));
        known.push({ label: "Ketik manual...", value: "__manual__" });
        let chosen = await select("Pilih dari daftar populer:", known);
        if (chosen === "__manual__") chosen = await input("Nama model Ollama:");
        setEnv("MODEL_NAME", chosen);
      }
    } catch {
      spin.fail("Gagal scan.");
      setEnv("MODEL_NAME", await input("Nama model:", ollamaMod.DEFAULT_MODEL));
    }
  } else {
    const models = await getProviderModels(newProvider);
    if (models.length) {
      const choices = models.map(m => ({ label: m.label || m.id, value: m.id }));
      choices.push({ label: "Ketik nama model sendiri...", value: "__custom__" });
      let chosen = await select("Pilih model:", choices);
      if (chosen === "__custom__") chosen = await input("Nama model:");
      setEnv("MODEL_NAME", chosen);
    } else {
      setEnv("MODEL_NAME", await input("Nama model:"));
    }
  }

  successLine(`Provider: ${newProvider}  →  Model: ${getEnv("MODEL_NAME")}`);
  sectionFooter();
}