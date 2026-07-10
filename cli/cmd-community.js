#!/usr/bin/env node
/**
 * cli/cmd-community.js
 * Handler untuk subcommand komunitas EMORA Hub:
 *   install:skill, install:tool, publish:skill, publish:tool, community --setkey
 *
 * Mendukung format install @user/nama sesuai docs API.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import readline from "readline";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import chalk from "chalk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// Load .env
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

// ── Warna & Gaya ────────────────────────────────────────────────────────────
const C = {
  dim: chalk.hex("#6e7681"),
  cyan: chalk.hex("#58a6ff"),
  green: chalk.hex("#3fb950"),
  yellow: chalk.hex("#d29922"),
  muted: chalk.hex("#8b949e"),
  red: chalk.hex("#f85149"),
  purple: chalk.hex("#a371f7"),
  white: chalk.hex("#e6edf3"),
  bold: chalk.bold,
  gradient: (text) => {
    // Gradient sederhana: cyan → purple
    const colors = ["#58a6ff", "#6aabff", "#7db0f7", "#9299f7", "#a371f7"];
    return text.split("").map((ch, i) => chalk.hex(colors[i % colors.length])(ch)).join("");
  }
};

// ── Konfigurasi ────────────────────────────────────────────────────────────
const HUB_BASE = process.env.EMORA_HUB || "https://emora-backend.vercel.app";

// ── Helper: dapatkan API key ──────────────────────────────────────────────
function getApiKey() {
  return process.env.EMORA_HUB_API_KEY || null;
}

// ── Helper: search ke Hub ──────────────────────────────────────────────────
async function searchHub(type, query) {
  const endpoint = type === "tool" ? "searchtool" : "searchskill";
  const url = `${HUB_BASE}/api/${endpoint}?q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gagal mencari: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

// ── Helper: install langsung dari slug (format @user/slug) ──────────────
async function installFromSlug(type, slug) {
  const cleanSlug = slug.startsWith("@") ? slug.slice(1) : slug;
  const [user, name] = cleanSlug.split("/");
  if (!user || !name) {
    throw new Error(`Format slug tidak valid: ${slug}. Gunakan @user/nama atau user/nama.`);
  }
  const endpoint = type === "tool" ? "install/tool" : "install/skill";
  const url = `${HUB_BASE}/api/${endpoint}/@${user}/${name}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gagal mendapatkan info paket: ${res.status} - ${err}`);
  }
  const data = await res.json();
  if (!data.success || !data.data) {
    throw new Error("Respon API tidak valid.");
  }
  return data.data;
}

// ── Helper: download file ──────────────────────────────────────────────────
async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gagal download: ${res.status}`);
  const buffer = await res.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(buffer));
}

// ── Helper: ekstrak zip ────────────────────────────────────────────────────
function extractZip(zipPath, targetDir) {
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  try {
    execSync(`unzip -o "${zipPath}" -d "${targetDir}"`, { stdio: "ignore" });
  } catch (_) {
    try {
      execSync(
        `powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force"`,
        { stdio: "ignore" }
      );
    } catch (e2) {
      throw new Error(`Gagal ekstrak zip: ${e2.message}`);
    }
  }
}

// ── Helper: buat zip dari folder ──────────────────────────────────────────
function zipFolder(folderPath, zipPath) {
  const parent = path.dirname(folderPath);
  const base = path.basename(folderPath);
  try {
    execSync(`cd "${parent}" && zip -r "${zipPath}" "${base}"`, { stdio: "ignore" });
  } catch (_) {
    try {
      execSync(
        `powershell -command "Compress-Archive -Path '${folderPath}' -DestinationPath '${zipPath}' -Force"`,
        { stdio: "ignore" }
      );
    } catch (e2) {
      throw new Error(`Gagal membuat zip: ${e2.message}`);
    }
  }
}

// ── Helper: tanya user ────────────────────────────────────────────────────
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(C.cyan(query), (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// ── DETEKSI NAMA EXPORT DARI FILE JS ─────────────────────────────────────
function detectExportName(filePath) {
  const content = fs.readFileSync(filePath, "utf8");

  // 1. Cari export const nama = ...
  const namedExport = content.match(/export\s+const\s+(\w+)\s*=/);
  if (namedExport) return namedExport[1];

  // 2. Cari export default nama (tanpa kurung)
  const defaultExport = content.match(/export\s+default\s+(\w+)/);
  if (defaultExport) return defaultExport[1];

  // 3. Cari export { nama } di akhir
  const bracketExport = content.match(/export\s*\{\s*(\w+)\s*\}/);
  if (bracketExport) return bracketExport[1];

  // 4. Fallback: nama file (tanpa ekstensi) + "Tool" (dengan konversi ke camelCase jika perlu)
  const baseName = path.basename(filePath, ".js");
  // Ubah kebab-case / snake_case ke camelCase
  const camel = baseName.replace(/[_-]([a-z])/g, (_, c) => c.toUpperCase());
  return camel + "Tool";
}

// ── INSTALL SKILL ──────────────────────────────────────────────────────────
export async function installSkill(name) {
  try {
    console.log(C.gradient("\n  ═══ INSTALL SKILL ═══\n"));

    let pkgInfo;
    if (name.includes("/")) {
      console.log(C.dim(`  📦 Mengambil info paket dari slug: ${C.cyan(name)} ...`));
      pkgInfo = await installFromSlug("skill", name);
      console.log(C.green(`  ✅ Ditemukan: ${C.bold(pkgInfo.name)} (${C.yellow(pkgInfo.version)})`));
      console.log(C.muted(`  📖 ${pkgInfo.description}`));
      if (pkgInfo.dependencies && pkgInfo.dependencies.length) {
        console.log(C.muted(`  📦 Dependencies: ${pkgInfo.dependencies.map(d => d.name).join(", ")}`));
      }
      const confirm = await askQuestion(`  Install skill ini? (y/n) `);
      if (confirm.toLowerCase() !== "y") {
        console.log(C.yellow("  ⏹️ Dibatalkan."));
        return;
      }
    } else {
      console.log(C.dim(`  🔍 Mencari skill "${C.cyan(name)}" di EMORA Hub...`));
      const items = await searchHub("skill", name);
      if (items.length === 0) {
        console.log(C.red(`  ❌ Skill "${name}" tidak ditemukan.`));
        return;
      }
      const item = items[0];
      console.log(C.green(`  ✅ Ditemukan: ${C.bold(item.name)}`));
      console.log(C.muted(`  📖 ${item.description}`));
      const confirm = await askQuestion(`  Download dan install skill "${item.name}"? (y/n) `);
      if (confirm.toLowerCase() !== "y") {
        console.log(C.yellow("  ⏹️ Dibatalkan."));
        return;
      }
      const slug = `${item.author}/${item.slug}`;
      pkgInfo = await installFromSlug("skill", slug);
    }

    const downloadDir = path.join(ROOT_DIR, "downloads");
    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

    const zipName = `${pkgInfo.name.replace(/[^a-z0-9_]/g, "_")}.zip`;
    const zipPath = path.join(downloadDir, zipName);

    console.log(C.dim(`  ⬇️ Mendownload ${pkgInfo.download} ...`));
    await downloadFile(pkgInfo.download, zipPath);
    console.log(C.green(`  ✅ Download selesai: ${C.cyan(zipPath)}`));

    const tempDir = path.join(downloadDir, `temp_${Date.now()}`);
    console.log(C.dim(`  📦 Mengekstrak...`));
    extractZip(zipPath, tempDir);

    const files = fs.readdirSync(tempDir);
    const mdFile = files.find((f) => f.endsWith(".md"));
    if (!mdFile) {
      console.log(C.red(`  ❌ Tidak ditemukan file .md di dalam zip.`));
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(zipPath, { force: true });
      return;
    }

    const content = fs.readFileSync(path.join(tempDir, mdFile), "utf8");
    const skillName = pkgInfo.slug || pkgInfo.name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const skillDir = path.join(ROOT_DIR, "skill", skillName);
    if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "skill.md"), content);
    console.log(C.green(`  ✅ Skill berhasil diinstall ke ${C.cyan(skillDir)}`));

    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
    console.log(C.muted(`  🧹 Bersih-bersih selesai.`));
    console.log(C.green(`  🎉 Selesai! Skill siap digunakan.`));
  } catch (err) {
    console.error(C.red(`  ❌ Gagal install skill: ${err.message}`));
  }
}

// ── INSTALL TOOL ──────────────────────────────────────────────────────────
export async function installTool(name) {
  try {
    console.log(C.gradient("\n  ═══ INSTALL TOOL ═══\n"));

    let pkgInfo;
    if (name.includes("/")) {
      console.log(C.dim(`  📦 Mengambil info paket dari slug: ${C.cyan(name)} ...`));
      pkgInfo = await installFromSlug("tool", name);
      console.log(C.green(`  ✅ Ditemukan: ${C.bold(pkgInfo.name)} (${C.yellow(pkgInfo.version)})`));
      console.log(C.muted(`  📖 ${pkgInfo.description}`));
      if (pkgInfo.dependencies && pkgInfo.dependencies.length) {
        console.log(C.muted(`  📦 Dependencies: ${pkgInfo.dependencies.map(d => d.name).join(", ")}`));
      }
      const confirm = await askQuestion(`  Install tool ini? (y/n) `);
      if (confirm.toLowerCase() !== "y") {
        console.log(C.yellow("  ⏹️ Dibatalkan."));
        return;
      }
    } else {
      console.log(C.dim(`  🔍 Mencari tool "${C.cyan(name)}" di EMORA Hub...`));
      const items = await searchHub("tool", name);
      if (items.length === 0) {
        console.log(C.red(`  ❌ Tool "${name}" tidak ditemukan.`));
        return;
      }
      const item = items[0];
      console.log(C.green(`  ✅ Ditemukan: ${C.bold(item.name)}`));
      console.log(C.muted(`  📖 ${item.description}`));
      const confirm = await askQuestion(`  Download dan install tool "${item.name}"? (y/n) `);
      if (confirm.toLowerCase() !== "y") {
        console.log(C.yellow("  ⏹️ Dibatalkan."));
        return;
      }
      const slug = `${item.author}/${item.slug}`;
      pkgInfo = await installFromSlug("tool", slug);
    }

    const downloadDir = path.join(ROOT_DIR, "downloads");
    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

    const zipName = `${pkgInfo.name.replace(/[^a-z0-9_]/g, "_")}.zip`;
    const zipPath = path.join(downloadDir, zipName);

    console.log(C.dim(`  ⬇️ Mendownload ${pkgInfo.download} ...`));
    await downloadFile(pkgInfo.download, zipPath);
    console.log(C.green(`  ✅ Download selesai: ${C.cyan(zipPath)}`));

    const tempDir = path.join(downloadDir, `temp_${Date.now()}`);
    console.log(C.dim(`  📦 Mengekstrak...`));
    extractZip(zipPath, tempDir);

    const files = fs.readdirSync(tempDir);
    const jsFile = files.find((f) => f.endsWith(".js"));
    if (!jsFile) {
      console.log(C.red(`  ❌ Tidak ditemukan file .js di dalam zip.`));
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(zipPath, { force: true });
      return;
    }

    const content = fs.readFileSync(path.join(tempDir, jsFile), "utf8");
    const toolBaseName = path.basename(jsFile, ".js");
    const toolsDir = path.join(ROOT_DIR, "tools");
    if (!fs.existsSync(toolsDir)) fs.mkdirSync(toolsDir, { recursive: true });
    const toolPath = path.join(toolsDir, `${toolBaseName}.js`);
    fs.writeFileSync(toolPath, content);
    console.log(C.green(`  ✅ Tool berhasil disalin ke ${C.cyan(toolPath)}`));

    // ── Deteksi nama export yang sebenarnya ──────────────────────────
    const exportName = detectExportName(toolPath);
    console.log(C.muted(`  🔍 Nama export terdeteksi: ${C.cyan(exportName)}`));

    // ── Registrasi ke core/tools.js ──────────────────────────────────
    console.log(C.dim(`  📝 Mendaftarkan tool ke core/tools.js...`));
    const coreToolsPath = path.join(ROOT_DIR, "core", "tools.js");
    let coreContent = fs.readFileSync(coreToolsPath, "utf8");

    // Cek apakah sudah terdaftar (gunakan exportName)
    const importRegex = new RegExp(
      `import\\s+\\{?\\s*${exportName}\\s*\\}?\\s*from\\s*["']\\.\\.\\/tools\\/${toolBaseName}\\.js["']`
    );
    if (importRegex.test(coreContent)) {
      console.log(C.yellow(`  ⚠️ Tool "${exportName}" sudah terdaftar. Melewati registrasi.`));
    } else {
      // Inject import
      const importLines = coreContent.match(/^import .*?;$/gm);
      const lastImport = importLines ? importLines[importLines.length - 1] : null;
      const insertIndex = lastImport ? coreContent.indexOf(lastImport) + lastImport.length : 0;
      const importStatement = `\nimport { ${exportName} } from "../tools/${toolBaseName}.js";`;
      coreContent = coreContent.slice(0, insertIndex) + importStatement + coreContent.slice(insertIndex);

      // Inject ke array tools
      const toolsArrayRegex = /const\s+tools\s*=\s*\[([\s\S]*?)\];/;
      const match = coreContent.match(toolsArrayRegex);
      if (match) {
        const lastBracketIndex = coreContent.lastIndexOf("];");
        const beforeBracket = coreContent.lastIndexOf("]", lastBracketIndex - 1);
        if (beforeBracket !== -1) {
          const inject = `\n  ${exportName},`;
          coreContent = coreContent.slice(0, beforeBracket + 1) + inject + coreContent.slice(beforeBracket + 1);
        } else {
          console.log(C.red(`  ❌ Gagal menemukan array tools. Registrasi manual diperlukan.`));
        }
      } else {
        console.log(C.red(`  ❌ Gagal menemukan array tools. Registrasi manual diperlukan.`));
      }
      fs.writeFileSync(coreToolsPath, coreContent);
      console.log(C.green(`  ✅ Registrasi selesai.`));
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
    console.log(C.muted(`  🧹 Bersih-bersih selesai.`));
    console.log(C.yellow(`  🔁 RESTART APLIKASI (node main.js) agar tool baru aktif.`));
  } catch (err) {
    console.error(C.red(`  ❌ Gagal install tool: ${err.message}`));
  }
}

// ── PUBLISH SKILL ─────────────────────────────────────────────────────────
export async function publishSkill(name, desc, tags) {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.log(C.red(`  ❌ API Key tidak ditemukan. Set key dulu: emora community --setkey=YOUR_API_KEY`));
    return;
  }
  const skillDir = path.join(ROOT_DIR, "skill", name);
  if (!fs.existsSync(skillDir)) {
    console.log(C.red(`  ❌ Skill "${name}" tidak ditemukan di skill/${name}`));
    return;
  }

  const zipName = `${name}.zip`;
  const zipPath = path.join(ROOT_DIR, "download", zipName);
  console.log(C.dim(`  📦 Membuat zip dari ${skillDir} ...`));
  zipFolder(skillDir, zipPath);
  console.log(C.green(`  ✅ Zip created: ${zipPath}`));

  console.log(C.dim(`  ⬆️ Mengupload ke EMORA Hub...`));
  const result = await uploadItem("skill", zipPath, desc, tags, apiKey, name);
  console.log(result);
  fs.rmSync(zipPath, { force: true });
}

// ── PUBLISH TOOL ──────────────────────────────────────────────────────────
export async function publishTool(name, desc, tags) {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.log(C.red(`  ❌ API Key tidak ditemukan. Set key dulu: emora community --setkey=YOUR_API_KEY`));
    return;
  }
  const toolPath = path.join(ROOT_DIR, "tools", `${name}.js`);
  if (!fs.existsSync(toolPath)) {
    console.log(C.red(`  ❌ Tool "${name}" tidak ditemukan di tools/${name}.js`));
    return;
  }

  const tempDir = path.join(ROOT_DIR, "download", `temp_publish_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  fs.copyFileSync(toolPath, path.join(tempDir, `${name}.js`));
  const zipName = `${name}.zip`;
  const zipPath = path.join(ROOT_DIR, "download", zipName);
  console.log(C.dim(`  📦 Membuat zip dari ${name}.js ...`));
  zipFolder(tempDir, zipPath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log(C.green(`  ✅ Zip created: ${zipPath}`));

  console.log(C.dim(`  ⬆️ Mengupload ke EMORA Hub...`));
  const result = await uploadItem("tool", zipPath, desc, tags, apiKey, name);
  console.log(result);
  fs.rmSync(zipPath, { force: true });
}

// ── UPLOAD ITEM (internal) ───────────────────────────────────────────────
async function uploadItem(type, filePath, description, tags, apiKey, name) {
  const uploadTipe = type === "tool" ? "tools" : "skill";
  const fileBuffer = fs.readFileSync(filePath);
  const fileBlob = new Blob([fileBuffer]);
  const formData = new FormData();
  formData.append("tipe", uploadTipe);
  formData.append("name", name || path.basename(filePath, ".zip"));
  formData.append("description", description || "");
  formData.append("tags", tags || "");
  formData.append("file", fileBlob, path.basename(filePath));

  const postUrl = `${HUB_BASE}/post?apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(postUrl, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Upload error ${res.status}: ${errText}`);
  }
  const result = await res.json();
  if (result.success) {
    return C.green(`  ✅ Upload berhasil! ID: ${C.cyan(result.data.id)}\n  📦 Install: ${C.yellow(result.data.installCmd)}`);
  } else {
    throw new Error(result.message || "Upload gagal");
  }
}

// ── SET API KEY ───────────────────────────────────────────────────────────
export function setApiKey(key) {
  const envPath = path.join(ROOT_DIR, ".env");
  let envContent = "";
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, "utf8");
  }
  const regex = /^EMORA_HUB_API_KEY=.*$/m;
  if (regex.test(envContent)) {
    envContent = envContent.replace(regex, `EMORA_HUB_API_KEY=${key}`);
  } else {
    envContent += `\nEMORA_HUB_API_KEY=${key}\n`;
  }
  fs.writeFileSync(envPath, envContent);
  console.log(C.green(`  ✅ API Key disimpan di .env`));
}