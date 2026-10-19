/**
 * tools/verify.js
 *
 * Jalankan test/build project untuk verifikasi sebelum present hasil.
 * Auto-detect framework (pure function, bisa di-unit-test):
 *   package.json + scripts.test → npm/pnpm/yarn/bun test (deteksi lockfile)
 *   Makefile                     → make test
 *   Cargo.toml                   → cargo test
 *   pytest.ini / pyproject.toml / test_*.py → pytest atau python -m pytest
 *   go.mod                       → go test ./...
 *
 * Security: spawn TANPA shell (args array) — anti command-injection.
 * Timeout 60s, output truncate 8KB.
 */
import fsSync from "fs";
import path from "path";
import { spawn } from "child_process";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const TIMEOUT_MS = 60_000;
const MAX_OUTPUT = 8 * 1024;

export function detectFramework(dir) {
  const exists = (f) => fsSync.existsSync(path.join(dir, f));
  try {
    if (exists("package.json")) {
      try {
        const pkg = JSON.parse(fsSync.readFileSync(path.join(dir, "package.json"), "utf8"));
        if (pkg.scripts?.test) {
          // Deteksi package manager dari lockfile (tanpa shell).
          if (exists("pnpm-lock.yaml")) return { cmd: "pnpm", args: ["test"], framework: "pnpm test" };
          if (exists("yarn.lock")) return { cmd: "yarn", args: ["test"], framework: "yarn test" };
          if (exists("bun.lockb")) return { cmd: "bun", args: ["test"], framework: "bun test" };
          return { cmd: "npm", args: ["test"], framework: "npm test" };
        }
        return null;
      } catch { return null; }
    }
    if (exists("Makefile")) return { cmd: "make", args: ["test"], framework: "make test" };
    if (exists("Cargo.toml")) return { cmd: "cargo", args: ["test"], framework: "cargo test" };
    if (exists("go.mod")) return { cmd: "go", args: ["test", "./..."], framework: "go test" };
    // Python: cek config modern dulu, baru pola file.
    if (exists("pytest.ini") || exists("pyproject.toml") || exists("setup.cfg")) {
      return { cmd: "python3", args: ["-m", "pytest", "-q"], framework: "pytest" };
    }
    try {
      const entries = fsSync.readdirSync(dir);
      if (entries.some((f) => /^test_.*\.py$/.test(f) || /^.*_test\.py$/.test(f))) {
        return { cmd: "python3", args: ["-m", "pytest", "-q"], framework: "pytest" };
      }
    } catch { /* abaikan */ }
  } catch { return null; }
  return null;
}

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    let stdout = "", stderr = "", done = false;
    let child;
    try {
      // TANPA shell:true — args diteruskan langsung (anti-injeksi).
      child = spawn(cmd, args, { cwd, shell: false, env: { ...process.env, FORCE_COLOR: "0" } });
    } catch (err) {
      return resolve({ code: -1, output: err.message });
    }

    const timer = setTimeout(() => {
      if (!done) { done = true; try { child.kill("SIGKILL"); } catch {} resolve({ code: -1, output: `${stdout}${stderr}\n[TIMEOUT 60s — perkecil scope test]` }); }
    }, TIMEOUT_MS);

    child.stdout?.on("data", (d) => { if (stdout.length < MAX_OUTPUT) stdout += d; });
    child.stderr?.on("data", (d) => { if (stderr.length < MAX_OUTPUT) stderr += d; });
    child.on("error", (err) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: -1, output: `Gagal spawn '${cmd}': ${err.message}. Pastikan binary ter-install.` }); } });
    child.on("close", (code) => {
      if (!done) { done = true; clearTimeout(timer); resolve({ code: code ?? -1, output: (`${stdout}${stderr}`).slice(0, MAX_OUTPUT) }); }
    });
  });
}

import { delegateToSubagent } from "./subagent.js";

export const verifyTool = new DynamicStructuredTool({
  name: "verify",
  description: "Jalankan test/build project (auto-detect, tanpa shell) DAN/ATAU audit via subagent. " +
               "WAJIB dipanggil setelah mengubah kode. Workflow: buat -> verify -> perbaiki -> verify lagi.",
  schema: z.object({
    path: z.string().optional().describe("Path project untuk testing (default: cwd)"),
    files_to_audit: z.array(z.string()).optional().describe("Daftar file absolut yang baru diubah untuk diaudit. Wajib jika ingin review."),
  }),
  func: async ({ path: dir = ".", files_to_audit = [] }) => {
    try {
      const abs = path.resolve(dir);
      if (!fsSync.existsSync(abs)) return `❌ Path tidak ditemukan: ${dir}. Cek dengan list_files dulu.`;
      if (!fsSync.statSync(abs).isDirectory()) return `❌ Path bukan direktori: ${dir}.`;

      let testOutput = "";
      const fw = detectFramework(abs);
      if (fw) {
        const r = await run(fw.cmd, fw.args, abs);
        const ok = r.code === 0;
        testOutput = `[TEST RESULTS (${fw.framework})]\nStatus: ${ok ? "PASSED" : "FAILED"} (exit ${r.code})\nOutput:\n${r.output.slice(-2000)}\n\n`;
      } else {
        testOutput = `[TEST RESULTS]\nSkipped: no test framework detected (cek package.json scripts.test / Makefile / Cargo.toml / go.mod / pytest config).\n\n`;
      }

      let auditOutput = "";
      if (files_to_audit && files_to_audit.length > 0) {
        if (files_to_audit.length > 10) return `${testOutput}❌ Terlalu banyak file audit (>10). Audit 10 terpenting dulu.`;
        let codeContent = "";
        for (const f of files_to_audit) {
          const resolved = path.resolve(f);
          // Cegah baca di luar project / file raksasa.
          if (!resolved.startsWith(abs) && abs !== path.resolve(".")) {
            codeContent += `\n--- File: ${f} (DITOLAK: di luar path=${dir}) ---\n`;
            continue;
          }
          try {
            const stat = fsSync.statSync(resolved);
            if (stat.size > 100 * 1024) {
              codeContent += `\n--- File: ${f} (DILEWATI: >100KB) ---\n`;
              continue;
            }
            if (fsSync.existsSync(resolved)) {
              codeContent += `\n--- File: ${f} ---\n${fsSync.readFileSync(resolved, "utf8").slice(0, 8000)}\n`;
            } else {
              codeContent += `\n--- File: ${f} (TIDAK DITEMUKAN) ---\n`;
            }
          } catch (e) {
            codeContent += `\n--- File: ${f} (ERROR: ${e.message}) ---\n`;
          }
        }

        const task = `Kamu adalah Senior Code Auditor. Audit statis ketat.\n1. Cek error sintaks/logic\n2. Cek over-engineering\n3. Jika bagus: 'SUKSES: Kode sudah optimal, siap di-ship.'\n4. Jika jelek: daftar masalah + instruksi perbaikan.\n\nKODE:\n${codeContent.slice(0, 15000)}`;

        const auditResponse = await delegateToSubagent({ task, maxTokens: 4000 });
        if (auditResponse.success) {
          auditOutput = `[SUBAGENT CODE AUDIT]\n${auditResponse.result}\n`;
        } else {
          auditOutput = `[SUBAGENT CODE AUDIT]\nGagal: ${auditResponse.error}\n`;
        }
      }

      if (!files_to_audit?.length && !fw) {
         return "❌ Tidak ada test framework terdeteksi DAN files_to_audit kosong. Berikan file yang ingin diaudit!";
      }

      return `${testOutput}${auditOutput}`.trim();
    } catch (err) {
      return `❌ Error: ${err.message}`;
    }
  },
});
