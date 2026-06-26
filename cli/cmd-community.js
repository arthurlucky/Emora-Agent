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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

// Load .env
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const HUB_BASE = process.env.EMORA_HUB || "https://emora-hub--rellaja1214.replit.app";

// ── Helper: dapatkan API key ──────────────────────────────────────────────
function getApiKey() {
  return process.env.EMORA_HUB_API_KEY || null;
}

// ── Helper: search ke Hub ──────────────────────────────────────────────────
async function searchHub(type, query) {
  const endpoint = type === "tool" ? "searchtool" : "searchskill";
  const url = `${HUB_BASE}/${endpoint}?q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gagal mencari: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

// ── Helper: install langsung dari slug (format @user/slug) ──────────────
async function installFromSlug(type, slug) {
  // slug = "@johndoe/my-skill" atau "johndoe/my-skill"
  const cleanSlug = slug.startsWith("@") ? slug.slice(1) : slug;
  const [user, name] = cleanSlug.split("/");
  if (!user || !name) {
    throw new Error(`Format slug tidak valid: ${slug}. Gunakan @user/nama atau user/nama.`);
  }
  const endpoint = type === "tool" ? "install/tool" : "install/skill";
  const url = `${HUB_BASE}/${endpoint}/@${user}/${name}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gagal mendapatkan info paket: ${res.status} - ${err}`);
  }
  const data = await res.json();
  if (!data.success || !data.data) {
    throw new Error("Respon API tidak valid.");
  }
  return data.data; // { name, version, description, author, tags, dependencies, download, installCmd }
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
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// ── INSTALL SKILL ──────────────────────────────────────────────────────────
export async function installSkill(name) {
  try {
    // Cek apakah name berupa slug (@user/skill)
    let pkgInfo;
    if (name.includes("/")) {
      console.log(`📦 Mengambil info paket dari slug: ${name} ...`);
      pkgInfo = await installFromSlug("skill", name);
      console.log(`✅ Ditemukan: ${pkgInfo.name} (${pkgInfo.version})`);
      console.log(`📖 ${pkgInfo.description}`);
      if (pkgInfo.dependencies && pkgInfo.dependencies.length) {
        console.log(`📦 Dependencies: ${pkgInfo.dependencies.map(d => d.name).join(", ")}`);
      }
      const confirm = await askQuestion(`Install skill ini? (y/n) `);
      if (confirm.toLowerCase() !== "y") {
        console.log("⏹️ Dibatalkan.");
        return;
      }
    } else {
      // Cari dulu
      console.log(`🔍 Mencari skill "${name}" di EMORA Hub...`);
      const items = await searchHub("skill", name);
      if (items.length === 0) {
        console.log(`❌ Skill "${name}" tidak ditemukan.`);
        return;
      }
      const item = items[0];
      console.log(`✅ Ditemukan: ${item.name}`);
      console.log(`📖 ${item.description}`);
      const confirm = await askQuestion(`Download dan install skill "${item.name}"? (y/n) `);
      if (confirm.toLowerCase() !== "y") {
        console.log("⏹️ Dibatalkan.");
        return;
      }
      // Ambil info detail via install endpoint
      const slug = `${item.author}/${item.slug}`;
      pkgInfo = await installFromSlug("skill", slug);
    }

    const downloadDir = path.join(ROOT_DIR, "download");
    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

    const zipName = `${pkgInfo.name.replace(/[^a-z0-9_]/g, "_")}.zip`;
    const zipPath = path.join(downloadDir, zipName);

    console.log(`⬇️ Mendownload ${pkgInfo.download} ...`);
    await downloadFile(pkgInfo.download, zipPath);
    console.log(`✅ Download selesai: ${zipPath}`);

    const tempDir = path.join(downloadDir, `temp_${Date.now()}`);
    console.log(`📦 Mengekstrak...`);
    extractZip(zipPath, tempDir);

    const files = fs.readdirSync(tempDir);
    const mdFile = files.find((f) => f.endsWith(".md"));
    if (!mdFile) {
      console.log(`❌ Tidak ditemukan file .md di dalam zip.`);
      fs.rmSync(tempDir, { recursive: true, force: true });
      fs.rmSync(zipPath, { force: true });
      return;
    }

    const content = fs.readFileSync(path.join(tempDir, mdFile), "utf8");
    const skillName = pkgInfo.slug || pkgInfo.name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const skillDir = path.join(ROOT_DIR, "skill", skillName);
    if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "skill.md"), content);
    console.log(`✅ Skill berhasil diinstall ke ${skillDir}`);

    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
    console.log(`🧹 Bersih-bersih selesai.`);
  } catch (err) {
    console.error(`❌ Gagal install skill: ${err.message}`);
  }
}

// ── INSTALL TOOL ──────────────────────────────────────────────────────────
export async function installTool(name) {
  try {
    let pkgInfo;
    if (name.includes("/")) {
      console.log(`📦 Mengambil info paket dari slug: ${name} ...`);
      pkgInfo = await installFromSlug("tool", name);
      console.log(`✅ Ditemukan: ${pkgInfo.name} (${pkgInfo.version})`);
      console.log(`📖 ${pkgInfo.description}`);
      if (pkgInfo.dependencies && pkgInfo.dependencies.length) {
        console.log(`📦 Dependencies: ${pkgInfo.dependencies.map(d => d.name).join(", ")}`);
      }
      const confirm = await askQuestion(`Install tool ini? (y/n) `);
      if (confirm.toLowerCase() !== "y") {
        console.log("⏹️ Dibatalkan.");
        return;
      }
    } else {
      console.log(`🔍 Mencari tool "${name}" di EMORA Hub...`);
      const items = await searchHub("tool", name);
      if (items.length === 0) {
        console.log(`❌ Tool "${name}" tidak ditemukan.`);
        return;
      }
      const item = items[0];
      console.log(`✅ Ditemukan: ${item.name}`);
      console.log(`📖 ${item.description}`);
      const confirm = await askQuestion(`Download dan install tool "${item.name}"? (y/n) `);
      if (confirm.toLowerCase() !== "y") {
        console.log("⏹️ Dibatalkan.");
        return;
      }
      const slug = `${item.author}/${item.slug}`;
      pkgInfo = await installFromSlug("tool", slug);
    }

    const downloadDir = path.join(ROOT_DIR, "download");
    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

    const zipName = `${pkgInfo.name.replace(/[^a-z0-9_]/g, "_")}.zip`;
    const zipPath = path.join(downloadDir, zipName);

    console.log(`⬇️ Mendownload ${pkgInfo.download} ...`);
    await downloadFile(pkgInfo.download, zipPath);
    console.log(`✅ Download selesai: ${zipPath}`);

    const tempDir = path.join(downloadDir, `temp_${Date.now()}`);
    console.log(`📦 Mengekstrak...`);
    extractZip(zipPath, tempDir);

    const files = fs.readdirSync(tempDir);
    const jsFile = files.find((f) => f.endsWith(".js"));
    if (!jsFile) {
      console.log(`❌ Tidak ditemukan file .js di dalam zip.`);
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
    console.log(`✅ Tool berhasil disalin ke ${toolPath}`);

    // Registrasi ke core/tools.js
    console.log(`📝 Mendaftarkan tool ke core/tools.js...`);
    const coreToolsPath = path.join(ROOT_DIR, "core", "tools.js");
    let coreContent = fs.readFileSync(coreToolsPath, "utf8");

    const importRegex = new RegExp(
      `import\\s+\\{?\\s*${toolBaseName}Tool\\s*\\}?\\s*from\\s*["']\\.\\.\\/tools\\/${toolBaseName}\\.js["']`
    );
    if (importRegex.test(coreContent)) {
      console.log(`⚠️ Tool "${toolBaseName}" sudah terdaftar. Melewati registrasi.`);
    } else {
      // Inject import
      const importLines = coreContent.match(/^import .*?;$/gm);
      const lastImport = importLines ? importLines[importLines.length - 1] : null;
      const insertIndex = lastImport ? coreContent.indexOf(lastImport) + lastImport.length : 0;
      const importStatement = `\nimport { ${toolBaseName}Tool } from "../tools/${toolBaseName}.js";`;
      coreContent = coreContent.slice(0, insertIndex) + importStatement + coreContent.slice(insertIndex);

      // Inject ke array tools
      const toolsArrayRegex = /const\s+tools\s*=\s*\[([\s\S]*?)\];/;
      const match = coreContent.match(toolsArrayRegex);
      if (match) {
        const lastBracketIndex = coreContent.lastIndexOf("];");
        const beforeBracket = coreContent.lastIndexOf("]", lastBracketIndex - 1);
        if (beforeBracket !== -1) {
          const inject = `\n  ${toolBaseName}Tool,`;
          coreContent = coreContent.slice(0, beforeBracket + 1) + inject + coreContent.slice(beforeBracket + 1);
        } else {
          console.log(`❌ Gagal menemukan array tools. Registrasi manual diperlukan.`);
        }
      } else {
        console.log(`❌ Gagal menemukan array tools. Registrasi manual diperlukan.`);
      }
      fs.writeFileSync(coreToolsPath, coreContent);
      console.log(`✅ Registrasi selesai.`);
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
    console.log(`🧹 Bersih-bersih selesai.`);
    console.log(`🔁 RESTART APLIKASI (node main.js) agar tool baru aktif.`);
  } catch (err) {
    console.error(`❌ Gagal install tool: ${err.message}`);
  }
}

// ── PUBLISH SKILL ─────────────────────────────────────────────────────────
export async function publishSkill(name, desc, tags) {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.log(`❌ API Key tidak ditemukan. Set key dulu: emora community --setkey=YOUR_API_KEY`);
    return;
  }
  const skillDir = path.join(ROOT_DIR, "skill", name);
  if (!fs.existsSync(skillDir)) {
    console.log(`❌ Skill "${name}" tidak ditemukan di skill/${name}`);
    return;
  }

  const zipName = `${name}.zip`;
  const zipPath = path.join(ROOT_DIR, "download", zipName);
  console.log(`📦 Membuat zip dari ${skillDir} ...`);
  zipFolder(skillDir, zipPath);
  console.log(`✅ Zip created: ${zipPath}`);

  console.log(`⬆️ Mengupload ke EMORA Hub...`);
  const result = await uploadItem("skill", zipPath, desc, tags, apiKey, name);
  console.log(result);
  fs.rmSync(zipPath, { force: true });
}

// ── PUBLISH TOOL ──────────────────────────────────────────────────────────
export async function publishTool(name, desc, tags) {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.log(`❌ API Key tidak ditemukan. Set key dulu: emora community --setkey=YOUR_API_KEY`);
    return;
  }
  const toolPath = path.join(ROOT_DIR, "tools", `${name}.js`);
  if (!fs.existsSync(toolPath)) {
    console.log(`❌ Tool "${name}" tidak ditemukan di tools/${name}.js`);
    return;
  }

  const tempDir = path.join(ROOT_DIR, "download", `temp_publish_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  fs.copyFileSync(toolPath, path.join(tempDir, `${name}.js`));
  const zipName = `${name}.zip`;
  const zipPath = path.join(ROOT_DIR, "download", zipName);
  console.log(`📦 Membuat zip dari ${name}.js ...`);
  zipFolder(tempDir, zipPath);
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log(`✅ Zip created: ${zipPath}`);

  console.log(`⬆️ Mengupload ke EMORA Hub...`);
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
    return `✅ Upload berhasil! ID: ${result.data.id}\n📦 Install: ${result.data.installCmd}`;
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
  console.log(`✅ API Key disimpan di .env`);
}