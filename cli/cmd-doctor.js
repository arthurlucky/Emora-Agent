/**
 * cli/cmd-doctor.js — `emora doctor`
 * Diagnosa mandiri ala Hermes: env, provider, disk, memory, test suite.
 */
import "dotenv/config";
import os from "os";
import fs from "fs";
import { spawnSync } from "child_process";

const ok = (msg) => console.log(`  ✅ ${msg}`);
const warn = (msg) => console.log(`  ⚠️  ${msg}`);
const fail = (msg) => console.log(`  ❌ ${msg}`);

export async function cmdDoctor() {
  console.log("\n🩺 EMORA DOCTOR\n");

  // 1. Node version
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj >= 20) ok(`Node ${process.versions.node}`);
  else fail(`Node ${process.versions.node} — butuh >= 20`);

  // 2. Provider & API key
  const provider = process.env.MODEL_PROVIDER;
  if (!provider) fail("MODEL_PROVIDER belum diset — jalankan emora setup");
  else {
    ok(`Provider: ${provider} · Model: ${process.env.MODEL_NAME || "(belum diset)"}`);
    const needsKey = provider !== "ollama";
    const key = process.env.MODEL_API || process.env[`${provider.toUpperCase()}_API_KEY`];
    if (needsKey && !key) warn("API key kosong di .env (MODEL_API)");
    if (needsKey && key) ok(`API key: ***${key.slice(-4)}`);
  }

  // 3. Koneksi ke provider (kalau bukan ollama lokal, cek DNS saja — murah)
  if (provider === "ollama") {
    const url = (process.env.MODEL_URL || "http://localhost:11434/v1").replace("/v1", "");
    try {
      const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3000) });
      ok(r.ok ? `Ollama terjangkau di ${url}` : `Ollama merespon tapi status ${r.status}`);
    } catch {
      fail(`Ollama tidak terjangkau di ${url} — jalan kan dulu 'ollama serve'`);
    }
  } else {
    const url = process.env.MODEL_URL || "https://api.openai.com";
    const host = new URL(url).hostname;
    try {
      await fetch(`https://${host}`, { method: "HEAD", signal: AbortSignal.timeout(5000) }).catch(() => {});
      ok(`Jaringan ke ${host}: OK (atau diblokir firewall — cek API key kalau chat gagal)`);
    } catch {
      warn(`Tidak bisa menjangkau ${host} — cek koneksi internet`);
    }
  }

  // 4. Direktori penting
  for (const dir of ["memory", "skill", "plugins", ".emora"]) {
    fs.existsSync(dir) ? ok(`Folder ${dir}/ ada`) : warn(`Folder ${dir}/ hilang — jalankan emora setup`);
  }
  fs.existsSync(".env") ? ok(".env ada") : fail(".env hilang — jalankan emora setup");
  fs.existsSync("AGENT.md") ? ok("AGENT.md ada") : warn("AGENT.md hilang — agent jalan tanpa aturan");
  fs.existsSync("AGENT_LITE.md") ? ok("AGENT_LITE.md ada (auto untuk model kecil)") : warn("AGENT_LITE.md tidak ada");

  // 5. Memory health
  try {
    const files = fs.readdirSync("memory").filter((f) => f.endsWith(".json"));
    const totalKB = files.reduce((s, f) => s + fs.statSync(`memory/${f}`).size, 0) / 1024;
    ok(`Memory: ${files.length} sesi, ${totalKB.toFixed(1)} KB`);
    if (totalKB > 50_000) warn("Memory >50MB — pertimbangkan bersihkan: emora -s delete all");
  } catch { warn("Folder memory/ tidak bisa dibaca"); }

  // 6. Disk space
  try {
    const st = fs.statSyncSync?.() ?? null;
  } catch {}
  try {
    const { execSync } = await import("child_process");
    const df = execSync("df -k . | tail -1 | awk '{print $4}'", { encoding: "utf8" }).trim();
    const freeMB = Math.round(parseInt(df) / 1024);
    freeMB > 500 ? ok(`Disk bebas: ${freeMB} MB`) : fail(`Disk hampir penuh: ${freeMB} MB tersisa`);
  } catch { /* df tidak selalu ada */ }

  // 7. Test suite — pakai glob eksplisit (node --test <dir>/ tidak jalan di semua versi)
  console.log();
  const t = spawnSync("node", ["--test", ...[
    ...fs.readdirSync("tools/__tests__").map((f) => `tools/__tests__/${f}`),
    ...fs.readdirSync("core/__tests__").map((f) => `core/__tests__/${f}`),
  ].filter((f) => f.endsWith(".test.js"))], { encoding: "utf8", timeout: 60_000 });
  const passMatch = t.stdout?.match(/pass (\d+)/);
  const failMatch = t.stdout?.match(/fail (\d+)/);
  if (passMatch && failMatch) {
    const fails = parseInt(failMatch[1]);
    fails === 0 ? ok(`Test suite: ${passMatch[1]} pass, 0 fail`) : fail(`Test suite: ${failMatch[1]} FAILING`);
  } else {
    warn("Test suite tidak bisa dijalankan (folder test tidak ada?)");
  }

  // 8. Platform info
  ok(`Platform: ${os.platform()} ${os.arch()} · ${os.cpus().length} core · ${(os.totalmem() / 1e9).toFixed(1)}GB RAM`);

  console.log("\n  Jalankan tanpa flag ini kapan saja untuk cek ulang.\n");
}
