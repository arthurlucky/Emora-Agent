/**
 * cli/cmd-kl.js — `emora kl install <url>` (Knowledge Library v2)
 *
 * Workflow: curl URL → verifikasi LLM terhadap library/knowledge_policy.md →
 *   OK & belum ada → buat folder+file → simpan
 *   OK & sudah ada → update file existing
 *   REJECT         → tolak dengan log alasan
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { createLLM } from "../provider/index.js";
import { searchIndex as searchLibrary, writeEntry } from "../library/index.js";

export async function cmdKl(argv) {
  const sub = argv[0];
  if (sub !== "install") {
    console.log("Pakai: emora kl install <url> --topic=<topik> [--subtopic=<sub>] [--name=<nama-file>]");
    process.exit(1);
  }

  const url = argv[1];
  const getArg = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };
  const topic = getArg("--topic");
  const subtopic = getArg("--subtopic") || "umum";
  let name = getArg("--name");

  if (!url || !/^https?:\/\//.test(url)) {
    console.error("❌ URL wajib (http/https). Contoh: emora kl install https://... --topic=astronomi");
    process.exit(1);
  }
  if (!topic) {
    console.error("❌ --topic wajib. Contoh: --topic=astronomi --subtopic=galaksi");
    process.exit(1);
  }

  // ── 1. Fetch konten ────────────────────────────────────────────────────────
  console.log(`\n📥 Mengambil: ${url}`);
  let raw;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.text();
  } catch (e) {
    console.error(`❌ Gagal mengambil URL: ${e.message}`);
    process.exit(1);
  }

  // Ekstrak teks bermakna dari HTML sederhana.
  let content = raw;
  if (/<html|<body|<div/i.test(raw)) {
    content = raw
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, "\n")
      .replace(/&nbsp;/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  if (content.length < 200) {
    console.error(`❌ Konten terlalu pendek (${content.length} chars) — kemungkinan halaman JS-rendered atau error.`);
    process.exit(1);
  }
  content = content.slice(0, 40_000); // batasi untuk verifikasi
  console.log(`   Dapat ${content.length} karakter`);

  // ── 2. Verifikasi LLM terhadap knowledge_policy.md ────────────────────────
  console.log("\n🔍 Verifikasi terhadap Knowledge Policy...");
  let policy = "";
  try { policy = fs.readFileSync("library/knowledge_policy.md", "utf8"); } catch {}

  const llm = await createLLM([]);
  const verdictRes = await llm.invoke([
    {
      role: "system",
      content:
        `Kamu adalah verifier knowledge library. Terapkan policy ini KETAT:\n\n${policy}\n\n` +
        `Balas HANYA dengan format:\nVERDICT: OK|REJECT\nREASON: <satu kalimat>`,
    },
    { role: "user", content: content.slice(0, 12_000) },
  ]);
  const verdictText = typeof verdictRes.content === "string" ? verdictRes.content : String(verdictRes.content ?? "");
  const ok = /VERDICT:\s*OK/i.test(verdictText);
  const reasonMatch = verdictText.match(/REASON:\s*(.+)/i);

  if (!ok) {
    // [from condition] if:error → error log
    const logLine = `[${new Date().toISOString()}] REJECT ${url}\n  Reason: ${reasonMatch?.[1]?.trim() || verdictText.slice(0, 200)}\n`;
    fs.mkdirSync(".emora/kl-logs", { recursive: true });
    fs.appendFileSync(".emora/kl-logs/rejected.log", logLine);
    console.error(`\n❌ DITOLAK oleh policy: ${reasonMatch?.[1]?.trim() || "(lihat log)"}`);
    console.error(`   Log: .emora/kl-logs/rejected.log`);
    process.exit(1);
  }
  console.log(`   ✅ Lolos verifikasi: ${reasonMatch?.[1]?.trim() || "OK"}`);

  // ── 3. Cek existing → create atau update ──────────────────────────────────
  if (!name) {
    name = (url.split("/").pop() || "knowledge").replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]/gi, "_").slice(0, 60);
    name += ".txt";
  }
  if (!/\.(md|txt)$/.test(name)) name += ".txt";

  // Search path/subpath yang sudah ada
  const existing = searchLibrary({ topic, subtopic, query: name, maxResults: 50 });

  const date = new Date();
  const dateStr = `${String(date.getDate()).padStart(2, "0")}_${String(date.getMonth() + 1).padStart(2, "0")}_${date.getFullYear()}`;
  const wrapped =
    `# ${name.replace(/\.(md|txt)$/, "")}\n` +
    `Sumber: ${url}\nTanggal diambil: ${date.toLocaleDateString("id-ID")}\n` +
    `Verifikasi: lolos knowledge_policy (LLM)\n\n${content}`;

  const { relPath } = writeEntry({
    topic,
    subtopic,
    filename: name,
    content: wrapped,
    date,
  });

  if (existing.length) {
    console.log(`\n✅ Diperbarui: ${relPath} (${existing.length} versi lama tetap tersimpan per tanggal)`);
  } else {
    console.log(`\n✅ Knowledge baru ditambahkan: ${relPath}`);
  }
  console.log(`   Topik: ${topic} → ${subtopic}`);
  console.log(`   Tersedia via knowledge_library action:read relPath="${relPath}"`);
}
