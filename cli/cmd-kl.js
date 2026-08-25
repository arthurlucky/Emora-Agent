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
import readline from "readline";
import { createLLM } from "../provider/index.js";
import { searchIndex as searchLibrary, writeEntry } from "../library/index.js";

/** Verifikasi MANUAL saat LLM gagal (rate limit, quota, timeout, dll).
 *  Tampilkan preview konten + policy ringkas, user putuskan OK/REJECT.
 *  Return "VERDICT: OK\nREASON: manual" | "...REJECT..." | null (batal). */
async function manualVerificationFallback(err, content, url) {
  const msg = err?.message || String(err);
  console.error(`\n⚠️  LLM tidak tersedia untuk verifikasi otomatis: ${msg.slice(0, 120)}`);
  console.error("   (penyebab umum: rate limit 429, token limit, kuota habis, koneksi)");
  console.log("\n═══ VERIFIKASI MANUAL ═══");
  console.log(`URL   : ${url}`);
  console.log(`Panjang: ${content.length} chars`);
  console.log("\n--- Preview 1500 chars pertama ---");
  console.log(content.slice(0, 1500).replace(/\n{2,}/g, "\n"));
  console.log("--- Akhir preview ---\n");

  // Ringkasan aturan policy (baris bullet saja).
  try {
    const policy = fs.readFileSync("library/knowledge_policy.md", "utf8");
    const rules = policy.split("\n").filter(l => /^- /.test(l.trim())).slice(0, 10);
    if (rules.length) console.log("Aturan policy utama:\n" + rules.map(r => "  " + r).join("\n") + "\n");
  } catch {}

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(res =>
    rl.question("Lolos policy? [y]es / [n]o / [v]iew more / [c]ancel: ", res)
  );
  rl.close();

  const a = answer.trim().toLowerCase();
  if (a.startsWith("y")) return "VERDICT: OK\nREASON: disetujui manual oleh user (LLM unavailable)";
  if (a.startsWith("v")) {
    // Tampilkan lebih banyak, tanya lagi.
    console.log("\n--- Preview 5000 chars ---");
    console.log(content.slice(0, 5000));
    const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
    const a2 = await new Promise(res => rl2.question("Lolos policy? [y/n/c]: ", res));
    rl2.close();
    if (a2.trim().toLowerCase().startsWith("y")) return "VERDICT: OK\nREASON: disetujui manual oleh user (LLM unavailable)";
    if (a2.trim().toLowerCase().startsWith("c")) return null;
    return "VERDICT: REJECT\nREASON: ditolak manual oleh user";
  }
  if (a.startsWith("c")) return null;
  return "VERDICT: REJECT\nREASON: ditolak manual oleh user";
}

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
      console.warn(`   ⚠ Deteksi gagal (${e.message.slice(0, 60)}) — coba ulang...`);
      // Retry sekali setelah jeda (rate limit 429 sering).
      try {
        await new Promise(r => setTimeout(r, 8000));
        const clsRes2 = await llm.invoke([
          { role: "system", content: "Klasifikasi dokumen ke TOPIC dan SUBTOPIC. lowercase, underscore, bahasa Indonesia. Format persis:\nTOPIC: <topic>\nSUBTOPIC: <sub>" },
          { role: "user", content: content.slice(0, 6_000) },
        ]);
        const t2 = typeof clsRes2.content === "string" ? clsRes2.content : String(clsRes2.content ?? "");
        if (!topic) topic = (t2.match(/TOPIC:\s*([a-z0-9_-]+)/i)?.[1] || "").toLowerCase().trim();
        if (!subtopic) subtopic = (t2.match(/SUBTOPIC:\s*([a-z0-9_-]+)/i)?.[1] || "").toLowerCase().trim();
      } catch {}
    }
    // Fallback aman: turunkan dari slug URL, bukan "umum" buta.
    if (!topic || !subtopic) {
      const slug = (url.split("/").pop() || "").replace(/\.[a-z]+$/, "").toLowerCase();
      const words = slug.split("-").filter(Boolean);
      if (!topic) topic = words[0] || "umum";
      if (!subtopic) subtopic = words.slice(0, 3).join("_") || "umum";
    }
  }

  // ── 2b. Verifikasi LLM terhadap knowledge_policy.md ────────────────────────
  console.log("\n🔍 Verifikasi terhadap Knowledge Policy...");
  let policy = "";
  try { policy = fs.readFileSync("library/knowledge_policy.md", "utf8"); } catch {}

  let llmFailed = false;
  let verdictText = "";
  try {
    const verdictRes = await llm.invoke([
      {
        role: "system",
        content:
          `Kamu adalah verifier knowledge library. Terapkan policy ini KETAT:\n\n${policy}\n\n` +
          `Balas HANYA dengan format:\nVERDICT: OK|REJECT\nREASON: <satu kalimat>`,
      },
      { role: "user", content: content.slice(0, 12_000) },
    ]);
    verdictText = typeof verdictRes.content === "string" ? verdictRes.content : String(verdictRes.content ?? "");
  } catch (e) {
    llmFailed = true;
    verdictText = await manualVerificationFallback(e, content, url);
    if (verdictText === null) process.exit(1); // user batal
  }
  let ok = /VERDICT:\s*OK/i.test(verdictText);
  const reasonMatch = verdictText.match(/REASON:\s*(.+)/i);

  if (!ok && !llmFailed) {
    // Policy menyarankan ringkas bila masalahnya salinan utuh berhak cipta.
    if (/ringkas|salin|copyright|hak cipta|verbatim|utuh/i.test(reasonMatch?.[1] || "")) {
      console.log("\n📝 Policy minta ringkasan — meringkas konten via LLM...");
      let summarized = "";
      try {
        const sumRes = await llm.invoke([
          {
            role: "system",
            content:
              "Tulis ULANG dokumen berikut sebagai knowledge edukatif orisinal (maks 600 kata), " +
              "bahasa Indonesia, poin-poin terstruktur. WAJIB: parafrase total dengan kata-katamu " +
              "sendiri — JANGAN menyalin kalimat, frasa, menu navigasi, footer, atau struktur situs " +
              "asli. Hanya ekstrak FAKTA pengetahuannya.",
          },
          { role: "user", content: content.slice(0, 15_000) },
        ]);
        summarized = typeof sumRes.content === "string" ? sumRes.content : "";
      } catch (e) {
        // LLM gagal saat summarize → tawarkan verifikasi manual atas konten asli.
        console.warn(`   ⚠ Ringkasan gagal: ${e.message.slice(0, 80)}`);
        const manual = await manualVerificationFallback(e, content, url);
        if (manual === null) process.exit(1);
        ok = /VERDICT:\s*OK/i.test(manual);
        if (ok) console.log("   ✅ Disetujui manual (LLM gagal saat ringkasan)");
      }
      if (summarized.trim().length > 200) {
        content = `Ringkasan dari ${url} (original disimpan apa adanya di sumber):\n\n${summarized.trim()}`;
        console.log(`   ✅ Ringkasan siap (${content.length} chars) — verifikasi ulang...`);
        try {
          const reVerdict = await llm.invoke([
            { role: "system", content: `Policy:\n\n${policy}\n\nBalas HANYA: VERDICT: OK|REJECT\nREASON: <satu kalimat>` },
            { role: "user", content: content.slice(0, 12_000) },
          ]);
          const rt = typeof reVerdict.content === "string" ? reVerdict.content : String(reVerdict.content ?? "");
          ok = /VERDICT:\s*OK/i.test(rt);
        } catch (e) {
          console.warn(`   ⚠ Re-verifikasi gagal: ${e.message.slice(0, 80)}`);
          const manual2 = await manualVerificationFallback(e, content, url);
          if (manual2 === null) process.exit(1);
          ok = /VERDICT:\s*OK/i.test(manual2);
        }
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

  const date = new Date();
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
