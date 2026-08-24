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

  // ── KL VAULT — pilih backend penyimpanan knowledge ─────────────────────────
  if (sub === "vault") {
    const { writeVaultConfig } = await import("../cli/kl-vault.js");
    return writeVaultConfig(argv.slice(1));
  }

  if (sub === "list")   return (await import("../cli/kl-vault.js")).cmdKlList();
  if (sub === "search") return (await import("../cli/kl-vault.js")).cmdKlSearch(argv.slice(1));
  if (sub === "info")   return (await import("../cli/kl-vault.js")).cmdKlInfo(argv.slice(1));

  if (sub !== "install") {
    console.log("Perintah KL:");
    console.log("  emora kl vault                  Atur lokasi penyimpanan (default/obsidian/custom)");
    console.log("  emora kl install <url>          Tambah knowledge dari URL");
    console.log("  emora kl list                   Daftar topik & subtopik");
    console.log("  emora kl search <query>         Cari knowledge");
    console.log("  emora kl info <relPath>         Lihat metadata & backlink file");
    process.exit(1);
  }

  const url = argv[1];
  const getArg = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };
  let topic = getArg("--topic");
  let subtopic = getArg("--subtopic") || null;
  let name = getArg("--name");

  if (!url || !/^https?:\/\//.test(url)) {
    console.error("❌ URL wajib (http/https). Contoh: emora kl install https://...");
    console.error("   topic/subtopic opsional — LLM auto-detect dari konten.");
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

  const llm = await createLLM([]);

  // ── 2a. Auto-detect topic/subtopic via LLM kalau tidak diisi manual ──────
  if (!topic || !subtopic) {
    console.log("\n🏷️  Deteksi topik & subtopik dari konten...");
    try {
      const clsRes = await llm.invoke([
        {
          role: "system",
          content:
            "Klasifikasi dokumen berikut ke dalam TOPIC dan SUBTOPIC.\n" +
            "Aturan: lowercase, tanpa spasi (pakai underscore), bahasa Indonesia, " +
            "satu kata bila memungkinkan. Contoh output persis:\n" +
            "TOPIC: pertanian\nSUBTOPIC: pupuk_organik",
        },
        { role: "user", content: content.slice(0, 8_000) },
      ]);
      const t = typeof clsRes.content === "string" ? clsRes.content : String(clsRes.content ?? "");
      if (!topic) {
        topic = (t.match(/TOPIC:\s*([a-z0-9_-]+)/i)?.[1] || "").toLowerCase().trim();
      }
      if (!subtopic) {
        subtopic = (t.match(/SUBTOPIC:\s*([a-z0-9_-]+)/i)?.[1] || "").toLowerCase().trim();
      }
      console.log(`   → ${topic || "?"} / ${subtopic || "?"}`);
    } catch (e) {
      console.warn(`   ⚠ Deteksi gagal (${e.message.slice(0, 60)}) — pakai fallback.`);
    }
    // Fallback aman.
    topic = topic || "umum";
    subtopic = subtopic || "umum";
  }

  // ── 2b. Verifikasi LLM terhadap knowledge_policy.md ────────────────────────
  console.log("\n🔍 Verifikasi terhadap Knowledge Policy...");
  let policy = "";
  try { policy = fs.readFileSync("library/knowledge_policy.md", "utf8"); } catch {}
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
  let ok = /VERDICT:\s*OK/i.test(verdictText);
  const reasonMatch = verdictText.match(/REASON:\s*(.+)/i);

  if (!ok) {
    // Policy menyarankan ringkas bila masalahnya salinan utuh berhak cipta.
    if (/ringkas|salinan utuh|copyright|berhak cipta/i.test(reasonMatch?.[1] || "")) {
      console.log("\n📝 Policy minta ringkasan — meringkas konten via LLM...");
      try {
        const sumRes = await llm.invoke([
          {
            role: "system",
            content:
              "Ringkas dokumen berikut menjadi knowledge edukatif yang padat (maks 800 kata), " +
              "bahasa Indonesia, poin-poin terstruktur, TANPA menyalin kalimat asli secara utuh, " +
              "tanpa elemen navigasi/iklan/footer. Pertahankan semua fakta penting.",
          },
          { role: "user", content: content.slice(0, 15_000) },
        ]);
        const summarized = typeof sumRes.content === "string" ? sumRes.content : "";
        if (summarized.trim().length > 200) {
          content = `Ringkasan dari ${url} (original disimpan apa adanya di sumber):\n\n${summarized.trim()}`;
          console.log(`   ✅ Ringkasan siap (${content.length} chars) — verifikasi ulang...`);
          const reVerdict = await llm.invoke([
            { role: "system", content: `Policy:\n\n${policy}\n\nBalas HANYA: VERDICT: OK|REJECT\\nREASON: <satu kalimat>` },
            { role: "user", content: content.slice(0, 12_000) },
          ]);
          const rt = typeof reVerdict.content === "string" ? reVerdict.content : String(reVerdict.content ?? "");
          ok = /VERDICT:\s*OK/i.test(rt);
        }
      } catch (e) {
        console.warn(`   ⚠ Ringkasan gagal: ${e.message.slice(0, 60)}`);
      }
    }
  }

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

  // Tulis — V3 frontmatter + dedup via sourceUrl (update kalau URL sudah ada).
  const { relPath, updated } = writeEntry({
    topic,
    subtopic,
    filename: name,
    content,
    date,
    sourceUrl: url,
    meta: {
      title:    name.replace(/\.(md|txt)$/, ""),
      language: "id",
      tags:     [topic, subtopic],
    },
  });

  if (updated) {
    console.log(`\n🔄 Knowledge diperbarui (dedup by source URL): ${relPath}`);
  } else {
    console.log(`\n✅ Knowledge baru ditambahkan: ${relPath}`);
  }
  console.log(`   Topik: ${topic} → ${subtopic}`);
  console.log(`   Tersedia via knowledge_library action:read relPath="${relPath}"`);
}
