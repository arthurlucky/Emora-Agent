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

import { getEnv, setEnv } from "../core/config.js";

export async function cmdModel(args = []) {
  const { saveProfile, useProfile, removeProfile, listProfiles, formatList, listCustomEndpoints, removeCustomEndpoint, fetchCustomModels } =
    await import("../core/modelProfiles.js");

  // ── Profile multi-konfigurasi ─────────────────────────────────────────
  if (args[0] === "list") {
    console.log(formatList(await listProfiles()));
    return;
  }
  if (args[0] === "save") {
    try {
      await saveProfile(args[1]);
      console.log(`  ✓ Profile "${args[1]}" tersimpan (dari konfigurasi aktif).`);
    } catch (e) { console.error(`  ✗ ${e.message}`); }
    return;
  }
  if (args[0] === "use") {
    try {
      const p = await useProfile(args[1], setEnv);
      console.log(`  ✓ Beralih ke "${args[1]}": ${p.provider}/${p.model}`);
      console.log("     Restart TUI/gateway agar session baru memakai config ini.");
    } catch (e) { console.error(`  ✗ ${e.message}`); }
    return;
  }
  if (args[0] === "rm" || args[0] === "remove") {
    try {
      await removeProfile(args[1]);
      console.log(`  ✓ Profile "${args[1]}" dihapus.`);
    } catch (e) { console.error(`  ✗ ${e.message}`); }
    return;
  }

  // ── Hermes-style shortcut: `emora model set <provider> [model]` — tanpa wizard.
  if (args[0] === "set") {
    const provider = args[1], model = args.slice(2).join(" ");
    if (!provider) {
      console.error("  ✗ Gunakan: emora model set <provider> [model]");
      console.error(`     Provider: ${Object.keys(PROVIDERS).join(", ")}`);
      process.exit(1);
    }
    if (!PROVIDERS[provider]) {
      console.error(`  ✗ Provider tidak dikenal: ${provider}`);
      process.exit(1);
    }
    setEnv("MODEL_PROVIDER", provider);
    try {
      const mod = await import(`../provider/${provider === "custom" ? "customEndpoint" : provider}/index.js`);
      if (mod.BASE_URL && provider !== "ollama" && provider !== "custom") setEnv("MODEL_URL", mod.BASE_URL);
      if (!model && mod.DEFAULT_MODEL) setEnv("MODEL_NAME", mod.DEFAULT_MODEL);
    } catch {}
    if (model) setEnv("MODEL_NAME", model);
    console.log(`  ✓ Provider: ${provider}  →  Model: ${getEnv("MODEL_NAME") || "(belum diset)"}`);
    return;
  }

  const curProvider = getEnv("MODEL_PROVIDER") || "ollama";
  const curModel    = getEnv("MODEL_NAME") || "—";

  sectionHeader("MODEL SELECTOR", `Aktif: ${curProvider}  /  ${curModel}`);

  const savedProfiles = await listProfiles();
  const mainChoices = [];

  // 1. Model / Profile Tersimpan (Tampil Paling Atas)
  const savedKeys = Object.keys(savedProfiles);
  if (savedKeys.length > 0) {
    savedKeys.forEach(name => {
      const p = savedProfiles[name];
      const activeMarker = (p.provider === curProvider && p.model === curModel) ? " [AKTIF]" : "";
      mainChoices.push({
        label: `★ ${name.padEnd(28)} (${p.provider}/${p.model})${activeMarker}`,
        value: `profile:${name}`,
      });
    });
  }

  // 2. Pilihan Provider Standar
  Object.entries(PROVIDERS).forEach(([key, meta]) => {
    mainChoices.push({
      label: `${meta.label.padEnd(28)} [${meta.tier.toUpperCase()}]`,
      value: `provider:${key}`,
    });
  });

  // 3. Opsi Hapus Profile / Custom Model (Tampil Paling Bawah)
  mainChoices.push({
    label: "🗑️  Hapus Model Custom / Profile Tersimpan",
    value: "__delete__",
  });

  const selectedChoice = await select("Pilih model tersimpan, provider baru, atau kelola profile:", mainChoices);

  if (selectedChoice === "__back__") {
    sectionFooter();
    return;
  }

  // Hapus profile / custom model
  if (selectedChoice === "__delete__") {
    const allProfiles = await listProfiles();
    const customEps = await listCustomEndpoints();
    const deleteChoices = [];

    Object.keys(allProfiles).forEach(name => {
      deleteChoices.push({ label: `Profile: ${name}`, value: `profile:${name}` });
    });
    Object.keys(customEps).forEach(name => {
      if (!allProfiles[name]) {
        deleteChoices.push({ label: `Custom Endpoint: ${name}`, value: `ep:${name}` });
      }
    });

    if (deleteChoices.length === 0) {
      warnLine("Belum ada model tersimpan atau custom profile yang bisa dihapus.");
      sectionFooter();
      return;
    }

    const toDelete = await select("Pilih model custom/profile yang akan dihapus:", deleteChoices);
    const [type, targetName] = toDelete.split(":");
    
    if (type === "profile") {
      await removeProfile(targetName).catch(() => {});
      await removeCustomEndpoint(targetName).catch(() => {});
    } else {
      await removeCustomEndpoint(targetName).catch(() => {});
    }

    successLine(`Model custom/profile "${targetName}" berhasil dihapus.`);
    sectionFooter();
    return;
  }

  // Pakai profile tersimpan langsung
  if (selectedChoice.startsWith("profile:")) {
    const profileName = selectedChoice.replace("profile:", "");
    const p = await useProfile(profileName, setEnv);
    successLine(`Berhasil beralih ke profile tersimpan "${profileName}": ${p.provider} / ${p.model}`);
    sectionFooter();
    return;
  }

  // Setup Provider Baru
  const newProvider = selectedChoice.replace("provider:", "");
  setEnv("MODEL_PROVIDER", newProvider);

  // Update BASE_URL otomatis dari provider module
  try {
    const mod = await import(`../provider/${newProvider === "custom" ? "customEndpoint" : newProvider}/index.js`);
    if (mod.BASE_URL && newProvider !== "ollama" && newProvider !== "custom") {
      setEnv("MODEL_URL", mod.BASE_URL);
    }
  } catch {}

  // Wajib selalu menanyakan API Key di semua provider (kecuali ollama tanpa auth)
  let curKey = getEnv("MODEL_API") || getEnv(`${newProvider.toUpperCase()}_API_KEY`) || "";
  if (newProvider !== "ollama") {
    try {
      const mod = await import(`../provider/${newProvider === "custom" ? "customEndpoint" : newProvider}/index.js`);
      if (mod.KEY_URL) {
        console.log(`  ℹ Dapatkan API Key ${PROVIDERS[newProvider]?.label || newProvider} di: ${mod.KEY_URL}`);
      }
    } catch {}

    const promptLabel = curKey
      ? `${PROVIDERS[newProvider]?.label || newProvider} API Key (Enter untuk tetap pakai yang tersimpan):`
      : `${PROVIDERS[newProvider]?.label || newProvider} API Key:`;
    
    const inputKey = await input(promptLabel, "", true);
    if (inputKey.trim()) {
      curKey = inputKey.trim();
      setEnv("MODEL_API", curKey);
      const envKeyName = {
        anthropic:   "ANTHROPIC_API_KEY",
        huggingface: "HUGGINGFACE_API_KEY",
        openai:      "OPENAI_API_KEY",
        groq:        "GROQ_API_KEY",
        gemini:      "GEMINI_API_KEY",
        openrouter:  "OPENROUTER_API_KEY",
      }[newProvider];
      if (envKeyName) setEnv(envKeyName, curKey);
    }
  }

  // Custom Endpoint & Alias Setup
  if (newProvider === "custom") {
    const customEndpoints = await listCustomEndpoints();
    const customChoices = Object.entries(customEndpoints).map(([name, ep]) => ({
      label: `${name} (${ep.url})`,
      value: name,
    }));

    customChoices.push({ label: "➕ Tambah Custom Endpoint URL Baru...", value: "__new__" });

    const chosenEp = await select("Pilih Custom Endpoint:", customChoices);

    let targetUrl = "";
    let epName = "";

    if (chosenEp === "__new__") {
      targetUrl = await input("Masukkan URL Custom Endpoint (mis. http://localhost:11434/v1):");
      epName = await input("Nama Alias untuk model ini (mis. duzzu(gemini 3.6 flash)):");
    } else {
      targetUrl = customEndpoints[chosenEp].url;
      epName = chosenEp;
    }

    setEnv("MODEL_URL", targetUrl);

    // Live scan model dari URL custom
    const spin = ora(`  Live scanning models dari ${targetUrl}...`).start();
    const liveModels = await fetchCustomModels(targetUrl, curKey);

    let selectedModel = "";
    if (liveModels.length > 0) {
      spin.succeed(`Ditemukan ${liveModels.length} model live dari ${targetUrl}`);
      const modelChoices = liveModels.map(m => ({ label: m.name, value: m.id }));
      modelChoices.push({ label: "Ketik nama model manual...", value: "__manual__" });
      selectedModel = await select("Pilih model live:", modelChoices);
      if (selectedModel === "__manual__") selectedModel = await input("Nama model:");
    } else {
      spin.fail("Gagal scan live model dari URL tersebut.");
      selectedModel = await input("Nama model manual:");
    }

    setEnv("MODEL_NAME", selectedModel);

    // Format alias: duzzu(gemini 3.6 flash)
    const finalAlias = epName.includes("(") ? epName : `${epName}(${selectedModel})`;
    await saveProfile(finalAlias);
    successLine(`Model custom tersimpan dengan alias "${finalAlias}"`);
    sectionFooter();
    return;
  }

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
    const spin = ora(`  Scanning live models dari ${PROVIDERS[newProvider]?.label || newProvider}...`).start();
    const models = await getProviderModels(newProvider, curKey);
    if (models.length) {
      spin.succeed(`Ditemukan ${models.length} model (live scan)`);
      const choices = models.map(m => ({ label: m.label || m.id, value: m.id }));
      choices.push({ label: "Ketik nama model sendiri...", value: "__custom__" });
      let chosen = await select("Pilih model:", choices);
      if (chosen === "__custom__") chosen = await input("Nama model:");
      setEnv("MODEL_NAME", chosen);
    } else {
      spin.fail("Gagal scan live model.");
      setEnv("MODEL_NAME", await input("Nama model:"));
    }
  }

  // Auto-save ke profile tersimpan dengan alias
  const activeModel = getEnv("MODEL_NAME");
  const defaultAlias = `${newProvider}(${activeModel})`;
  const aliasInput = await input(`Nama alias untuk profile ini (default: ${defaultAlias}):`, defaultAlias);
  await saveProfile(aliasInput.trim() || defaultAlias);

  successLine(`Provider: ${newProvider}  →  Model: ${activeModel} (Alias: ${aliasInput})`);
  sectionFooter();
}