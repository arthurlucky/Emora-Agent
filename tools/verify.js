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

export const verifyTool = new DynamicStructuredTool({
  name: "verify",
  description: "Jalankan test/build project di path tertentu (auto-detect: npm/make/cargo/pytest/go). WAJIB dipanggil setelah perubahan kode sebelum present hasil ke user.",
  schema: z.object({
    path: z.string().optional().describe("Path project (default: cwd)"),
  }),
  func: async ({ path: dir = "." }) => {
    try {
      const abs = path.resolve(dir);
      if (!fsSync.existsSync(abs)) return `❌ Path tidak ditemukan: ${dir}`;

      const fw = detectFramework(abs);
      if (!fw) {
        return JSON.stringify({ ok: true, skipped: "no test framework detected (package.json tanpa scripts.test / Makefile / Cargo.toml / pytest / go.mod)" });
      }

      const r = await run(fw.cmd, fw.args, abs);
      const ok = r.code === 0;
      return JSON.stringify({
        ok,
        framework: fw.framework,
        exitCode: r.code,
        summary: ok ? "passed" : "FAILED",
        output: r.output.slice(-2000), // tail saja untuk context
      }, null, 2);
    } catch (err) {
      return `❌ Error: ${err.message}`;
    }
  },
});
