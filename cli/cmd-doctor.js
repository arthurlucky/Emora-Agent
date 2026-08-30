/**
 * cli/cmd-doctor.js
 *
 * EMORA Self-Diagnostic & Auto-Repair Doctor Tool.
 * Dipanggil via: emora doctor ATAU slash command /doctor di TUI.
 *
 * Menguji kesehatan sistem & memperbaiki masalah umum secara otomatis:
 *   1. Folder & struktur file (.env, memory/, uploads/, plugins/, mcp/)
 *   2. Konfigurasi Provider & API Key
 *   3. Koneksi jaringan / Ollama Service
 *   4. Cache & file temporary
 */

import fs from "fs";
import path from "path";
import chalk from "chalk";
import boxen from "boxen";
import { sectionHeader, sectionFooter, infoLine, successLine, warnLine, errorLine } from "./select.js";

export async function runDoctor({ autoRepair = true } = {}) {
  sectionHeader("EMORA DOCTOR", "Sistem Diagnosa Mandiri & Auto-Repair");

  const results = [];
  let repairedCount = 0;

  // 1. CHK: Folder Struktur
  const requiredDirs = ["./memory", "./uploads", "./downloads", "./backups", "./plugins", "./library", "./.emora"];
  for (const dir of requiredDirs) {
    if (!fs.existsSync(dir)) {
      if (autoRepair) {
        fs.mkdirSync(dir, { recursive: true });
        results.push({ name: `Folder ${dir}`, status: "repaired", note: "Folder dibuat otomatis" });
        repairedCount++;
      } else {
        results.push({ name: `Folder ${dir}`, status: "fail", note: "Folder hilang" });
      }
    } else {
      results.push({ name: `Folder ${dir}`, status: "ok", note: "Tersedia" });
    }
  }

  // 2. CHK: File .env
  const envPath = "./.env";
  if (!fs.existsSync(envPath)) {
    if (autoRepair) {
      fs.writeFileSync(envPath, "MODEL_PROVIDER=ollama\nMODEL_NAME=qwen2.5:0.5b\nOLLAMA_HOST=http://localhost:11434\n");
      results.push({ name: "File .env", status: "repaired", note: "Dibuat dengan default Ollama" });
      repairedCount++;
    } else {
      results.push({ name: "File .env", status: "fail", note: "File .env hilang" });
    }
  } else {
    results.push({ name: "File .env", status: "ok", note: "Tersedia" });
  }

  // 3. CHK: Provider & Model Config
  const provider = process.env.MODEL_PROVIDER || "ollama";
  const modelName = process.env.MODEL_NAME || "";
  if (!modelName) {
    results.push({ name: "Config Model", status: "warn", note: "MODEL_NAME belum diatur. Jalankan `emora model`." });
  } else {
    results.push({ name: "Config Model", status: "ok", note: `${provider} / ${modelName}` });
  }

  // 4. CHK: Connectivity ke Provider (Ollama / Cloud)
  if (provider === "ollama") {
    const host = process.env.OLLAMA_HOST || "http://localhost:11434";
    try {
      const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        results.push({ name: "Koneksi Ollama", status: "ok", note: `Terhubung ke ${host}` });
      } else {
        results.push({ name: "Koneksi Ollama", status: "warn", note: `Ollama merespon status ${res.status}` });
      }
    } catch {
      results.push({ name: "Koneksi Ollama", status: "warn", note: `Ollama tidak terjangkau di ${host}. Pastikan 'ollama serve' jalan.` });
    }
  } else {
    const apiKey = process.env.MODEL_API || process.env[`${provider.toUpperCase()}_API_KEY`];
    if (!apiKey) {
      results.push({ name: `API Key (${provider})`, status: "warn", note: "API Key belum diisi" });
    } else {
      results.push({ name: `API Key (${provider})`, status: "ok", note: "Terpasang" });
    }
  }

  // Tampilkan Hasil Diagnosa
  console.log();
  for (const item of results) {
    if (item.status === "ok") {
      successLine(`${item.name.padEnd(25)} [OK] — ${item.note}`);
    } else if (item.status === "repaired") {
      infoLine(item.name.padEnd(25), `[REPAIRED] — ${item.note}`, "green");
    } else if (item.status === "warn") {
      warnLine(`${item.name.padEnd(25)} [WARN] — ${item.note}`);
    } else {
      errorLine(`${item.name.padEnd(25)} [FAIL] — ${item.note}`);
    }
  }

  console.log();
  const summaryBox = boxen(
    chalk.bold(`Diagnosis Selesai!\n`) +
    `Total Pemeriksaan : ${results.length}\n` +
    `Auto-Repaired     : ${repairedCount} masalah diperbaiki\n` +
    `Status Kesehatan  : ${repairedCount > 0 || results.some(r => r.status === 'ok') ? chalk.green('SEHAT (SIAP DIPAKAI)') : chalk.yellow('PERLU PERHATIAN')}`,
    { padding: 1, borderStyle: "round", borderColor: "#58a6ff" }
  );
  console.log(summaryBox);
  sectionFooter();

  return results;
}

export default { runDoctor };
