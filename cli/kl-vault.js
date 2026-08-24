/**
 * cli/kl-vault.js — `emora kl vault|list|search|info`
 *
 * vault: pilih mode (default/obsidian/custom), tulis KL_VAULT & KL_VAULT_PATH
 *        ke .env. Struktur otomatis dibuat.
 * list:   ringkasan topik & file count.
 * search: pencarian cepat di catalog.
 * info:   metadata satu entri.
 */
import fs from "fs";
import path from "path";
import { resolveKnowledgeRoot, VAULT_MODES } from "../library/storage.js";
import { loadIndex, searchIndex, readEntry, ROOT } from "../library/index.js";

function readEnv(key) {
  try {
    const m = fs.readFileSync(".env", "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
    return m ? m[1].trim() : "";
  } catch { return ""; }
}

function writeEnv(patch) {
  let txt = "";
  try { txt = fs.readFileSync(".env", "utf8"); } catch { txt = ""; }
  for (const [key, val] of Object.entries(patch)) {
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(txt)) txt = txt.replace(re, `${key}=${val}`);
    else txt += (txt.endsWith("\n") || !txt ? "" : "\n") + `${key}=${val}\n`;
  }
  fs.writeFileSync(".env", txt);
}

/** `emora kl vault [mode] [path]` — interactive bila tanpa argumen. */
export async function writeVaultConfig(argv) {
  const argMode = argv[0];
  const argPath = argv[1];

  let mode = (argMode || readEnv("KL_VAULT") || "default").toLowerCase();
  if (!VAULT_MODES.includes(mode)) {
    console.error(`❌ Mode tidak dikenal: ${mode}. Pilih: ${VAULT_MODES.join(" | ")}`);
    process.exit(1);
  }

  let customPath = argPath || readEnv("KL_VAULT_PATH") || "";

  if (mode === "obsidian") {
    const vault = readEnv("OBSIDIAN_VAULT_PATH") || "";
    if (!vault) {
      console.log("⚠️  OBSIDIAN_VAULT_PATH belum di-set di .env.");
      console.log("   Jalankan dulu `emora obsidian setup` (mode manual) lalu `emora kl vault obsidian` ulang.");
      console.log("   Atau pakai mode `custom <path>`.");
      process.exit(1);
    }
    console.log(`✓ Vault Obsidian terdeteksi: ${vault}`);
    console.log("  Knowledge akan disimpan di: <vault>/EMORA/Knowledge/");
  } else if (mode === "custom") {
    if (!customPath) {
      console.error("❌ Mode custom butuh path. Contoh: emora kl vault custom ~/Documents/Knowledge");
      process.exit(1);
    }
  }

  const patch = { KL_VAULT: mode };
  if (mode === "custom") patch.KL_VAULT_PATH = customPath;
  else patch.KL_VAULT_PATH = "";
  writeEnv(patch);

  // Auto-create struktur di backend baru.
  const { root, label } = resolveKnowledgeRoot();
  console.log(`\n✅ KL_VAULT=${mode}`);
  console.log(`   Lokasi aktif: ${label}`);

  // Probe: tampilkan info keberadaan.
  try {
    const idx = loadIndex();
    console.log(`   File knowledge saat ini: ${idx.count}`);
  } catch {
    console.log("   File knowledge saat ini: 0 (baru)");
  }
}

export function cmdKlList() {
  const { root, mode, label } = resolveKnowledgeRoot();
  const idx = loadIndex();
  const byTopic = {};
  for (const e of idx.entries) {
    if (!byTopic[e.topic]) byTopic[e.topic] = { count: 0, subs: new Set() };
    byTopic[e.topic].count++;
    byTopic[e.topic].subs.add(e.subtopic);
  }
  console.log(`📚 Knowledge Library`);
  console.log(`   Backend: ${mode} · ${label}`);
  console.log(`   Total: ${idx.count} file\n`);
  for (const [t, info] of Object.entries(byTopic).sort()) {
    console.log(`  📁 ${t}/  (${info.count} file, ${info.subs.size} subtopik)`);
    for (const s of [...info.subs].sort()) console.log(`     └─ ${s}/`);
  }
}

export function cmdKlSearch(argv) {
  const q = argv.join(" ");
  if (!q) { console.error("Pakai: emora kl search <query>"); process.exit(1); }
  const results = searchIndex(q, { maxResults: 15 });
  if (!results.length) { console.log(`Tidak ditemukan: "${q}"`); return; }
  console.log(`🔎 "${q}" → ${results.length} hasil\n`);
  for (const r of results) {
    console.log(`  [${r.score}] ${r.relPath}`);
    console.log(`      ${Math.round(r.sizeBytes/102.4)/10} KB · ${r.date}`);
  }
}

export function cmdKlInfo(argv) {
  const rel = argv[0];
  if (!rel) { console.error("Pakai: emora kl info library/<topik>/<sub>/<date>/<file>"); process.exit(1); }
  const idx = loadIndex();
  const entry = idx.entries.find(e => e.relPath === rel);
  if (!entry) { console.error(`❌ File tidak ada di index: ${rel}\n   Coba: emora kl search <keyword>`); process.exit(1); }

  console.log(`📄 ${entry.relPath}`);
  console.log(`   Topik: ${entry.topic} → ${entry.subtopic}`);
  console.log(`   Tanggal: ${entry.date} · ${Math.round(entry.sizeBytes/102.4)/10} KB`);

  const stat = fs.statSync(entry.absPath);
  console.log(`   Modified: ${stat.mtime.toLocaleString("id-ID")}`);

  // Frontmatter preview (baris 1-15)
  try {
    const txt = fs.readFileSync(entry.absPath, "utf8");
    const head = txt.slice(0, 400);
    console.log(`\n--- Head 400 chars ---`);
    console.log(head);
  } catch {}

  // Backlinks: file lain di library yang referensikan relPath ini (sederhana: grep teks)
  const target = rel.replace(/^library\//, "");
  const backlinks = idx.entries.filter(e =>
    e.relPath !== rel && safeRead(e.absPath).includes(target)
  );
  if (backlinks.length) {
    console.log(`\n🔗 Direferensikan di ${backlinks.length} file lain:`);
    for (const b of backlinks.slice(0, 5)) console.log(`   - ${b.relPath}`);
  }
}

function safeRead(p) { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } }
