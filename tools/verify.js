/**
 * tools/verify.js
 *
 * Jalankan test/build project untuk verifikasi sebelum present hasil.
 * Auto-detect framework dari file penanda (4 if/else, no abstraction):
 *   package.json + scripts.test → npm test
 *   Makefile                     → make test
 *   Cargo.toml                   → cargo test
 *   pytest.ini / test_*.py       → pytest
 *   go.mod                       → go test ./...
 *   Tidak ada                    → { ok: true, skipped }
 *
 * ponytail: timeout hard 60s, output di-truncate 8KB. Upgrade: streaming
 * output kalau perlu live log.
 */
import fsSync from "fs";
import path from "path";
import { spawn } from "child_process";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const TIMEOUT_MS = 60_000;
const MAX_OUTPUT = 8 * 1024;

function detectFramework(dir) {
  if (fsSync.existsSync(path.join(dir, "package.json"))) {
    try {
      const pkg = JSON.parse(fsSync.readFileSync(path.join(dir, "package.json"), "utf8"));
      if (pkg.scripts?.test) return { cmd: "npm", args: ["test"], framework: "npm test" };
      return null; // package.json ada tapi no test script
    } catch { return null; }
  }
  if (fsSync.existsSync(path.join(dir, "Makefile"))) return { cmd: "make", args: ["test"], framework: "make test" };
  if (fsSync.existsSync(path.join(dir, "Cargo.toml"))) return { cmd: "cargo", args: ["test"], framework: "cargo test" };
  if (fsSync.existsSync(path.join(dir, "pytest.ini")) || fsSync.readdirSync(dir).some(f => f.startsWith("test_") && f.endsWith(".py")))
    return { cmd: "pytest", args: [], framework: "pytest" };
  if (fsSync.existsSync(path.join(dir, "go.mod"))) return { cmd: "go", args: ["test", "./..."], framework: "go test" };
  return null;
}

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    let stdout = "", stderr = "", done = false;
    let child;
    try {
      child = spawn(cmd, args, { cwd, shell: true, env: { ...process.env, FORCE_COLOR: "0" } });
    } catch (err) {
      return resolve({ code: -1, output: err.message });
    }

    const timer = setTimeout(() => {
      if (!done) { done = true; child.kill("SIGKILL"); resolve({ code: -1, output: stdout + stderr + "\n[TIMEOUT 60s]" }); }
    }, TIMEOUT_MS);

    child.stdout?.on("data", (d) => { if (stdout.length < MAX_OUTPUT) stdout += d; });
    child.stderr?.on("data", (d) => { if (stderr.length < MAX_OUTPUT) stderr += d; });
    child.on("error", (err) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: -1, output: err.message }); } });
    child.on("close", (code) => {
      if (!done) { done = true; clearTimeout(timer); resolve({ code, output: (stdout + stderr).slice(0, MAX_OUTPUT) }); }
    });
  });
}

import { delegateToSubagent } from "./subagent.js";

export const verifyTool = new DynamicStructuredTool({
  name: "verify",
  description: "Jalankan test/build project (auto-detect) DAN/ATAU lakukan Code Audit via Subagent (Self-Reflection). " +
               "WAJIB dipanggil setelah mengubah kode untuk mengecek kualitas sebelum present hasil. " +
               "Workflow mu: buat -> verify (audit) -> jika error/gak optimal -> perbaiki -> verify lagi -> sukses.",
  schema: z.object({
    path: z.string().optional().describe("Path project untuk testing (default: cwd)"),
    files_to_audit: z.array(z.string()).optional().describe("Daftar file spesifik (path absolut) yang baru kamu ubah untuk diaudit oleh subagent. Wajib disuplai jika ingin di-review."),
  }),
  func: async ({ path: dir = ".", files_to_audit = [] }) => {
    try {
      const abs = path.resolve(dir);
      if (!fsSync.existsSync(abs)) return `❌ Path tidak ditemukan: ${dir}`;

      let testOutput = "";
      const fw = detectFramework(abs);
      if (fw) {
        const r = await run(fw.cmd, fw.args, abs);
        const ok = r.code === 0;
        testOutput = `[TEST RESULTS (${fw.framework})]\nStatus: ${ok ? "PASSED" : "FAILED"}\nOutput:\n${r.output.slice(-2000)}\n\n`;
      } else {
        testOutput = `[TEST RESULTS]\nSkipped: no test framework detected.\n\n`;
      }

      let auditOutput = "";
      if (files_to_audit && files_to_audit.length > 0) {
        let codeContent = "";
        for (const f of files_to_audit) {
          if (fsSync.existsSync(f)) {
            codeContent += `\n--- File: ${f} ---\n${fsSync.readFileSync(f, 'utf8')}\n`;
          } else {
            codeContent += `\n--- File: ${f} (TIDAK DITEMUKAN) ---\n`;
          }
        }

        const task = `Kamu adalah Senior Code Auditor. Lakukan audit statis pada kode berikut secara ketat.
Workflow Wajib:
1. Cek error sintaks / logic
2. Cek apakah kode gak optimal / over-engineered
3. Jika bagus, nyatakan 'SUKSES: Kode sudah optimal, siap di-ship.'
4. Jika jelek, berikan daftar masalah dan instruksikan Main Agent untuk memperbaikinya.

KODE:
${codeContent.slice(0, 15000)} // max 15k chars`;

        const auditResponse = await delegateToSubagent({ task, maxTokens: 4000 });
        if (auditResponse.success) {
          auditOutput = `[SUBAGENT CODE AUDIT]\n${auditResponse.result}\n`;
        } else {
          auditOutput = `[SUBAGENT CODE AUDIT]\nGagal mengeksekusi subagent: ${auditResponse.error}\n`;
        }
      }

      if (!files_to_audit?.length && !fw) {
         return "❌ Tidak ada test framework terdeteksi DAN kamu tidak menyuplai `files_to_audit`. Berikan file yang ingin diaudit!";
      }

      return `${testOutput}${auditOutput}`.trim();
    } catch (err) {
      return `❌ Error: ${err.message}`;
    }
  },
});
