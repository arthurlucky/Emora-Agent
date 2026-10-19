import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

// Import fungsi dari gateway
import { resolveWorkspacePath } from "../utils/workspace.js";
import { sendFileToUser } from "../gateway/index.js";

const BASE_DIR = path.resolve(process.cwd());
const DEFAULT_TIMEOUT = 60_000;
const MAX_TIMEOUT = 300_000;
const MAX_OUTPUT = 8000;

/**
 * Klasifikasi risiko perintah (HIGH hard-block / MEDIUM soft-block +
 * confirm_risky opt-in / LOW jalan normal) — lihat tools/lib/riskClassifier.js
 * untuk penjelasan lengkap & alasan rewrite dari BLACKLIST tunggal
 * sebelumnya. PENTING: ini tetap filter level aplikasi, BUKAN sandbox
 * proses/container sungguhan.
 */
import { classifyRisk } from "./lib/riskClassifier.js";

export const activeBashJobs = {};

function resolveCwd(cwd) {
  if (!cwd) return BASE_DIR;
  return path.isAbsolute(cwd) ? cwd : path.resolve(BASE_DIR, cwd);
}

export const bashTool = new DynamicStructuredTool({
  name: "bash",
  description:
    "Jalankan perintah terminal/bash/shell nyata. Perintah diklasifikasikan 3 tingkat risiko: LOW (jalan normal), MEDIUM (ditolak default, perlu confirm_risky:true setelah konfirmasi user — mis. rm -rf direktori sistem, curl|bash, eval), HIGH (diblokir permanen, tidak bisa di-override — fork bomb, mkfs, wipe root/home, shutdown). " +
    "BISA JUGA untuk kirim file ke user via Telegram ATAU WhatsApp (otomatis sesuai gateway aktif) menggunakan perintah khusus: sendFile --pathfile=\"...\" --text=\"...\"",
  schema: z.object({
    command: z.string(),
    session_id: z.string().describe("WAJIB DIISI dengan Session ID (dari [INFO SYSTEM]) HANYA JIKA menggunakan perintah sendFile!").optional(),
    cwd: z.string().describe("Working directory. Kosongkan untuk mengeksekusi di root project (Emora-Agent).").optional(),
    timeout: z.number().int().min(1000).max(MAX_TIMEOUT).optional(),
    create_cwd: z.boolean().optional().default(true),
    backend: z.string().describe("Backend eksekusi: 'local' (default) atau nama backend SSH dari .emora/backends.json (mis. 'myvps').").optional(),
    confirm_risky: z.boolean().optional().default(false).describe("Wajib true untuk menjalankan perintah yang terdeteksi MEDIUM RISK (mis. rm -rf pada direktori sistem, curl|bash, eval, dll). Tanya konfirmasi user dulu sebelum mengirim ulang dengan flag ini."),
  }),
  func: async ({ command, session_id, cwd, timeout = DEFAULT_TIMEOUT, create_cwd = true, backend = "local", confirm_risky = false }) => {

    // [INTERCEPTOR]: Cegat perintah sendFile (bekerja untuk Telegram MAUPUN WhatsApp)
    if (command.trim().startsWith("sendFile")) {
      if (!session_id) return "❌ Gagal: parameter session_id WAJIB diisi untuk sendFile.";

      const pathMatch = command.match(/--pathfile=(?:"([^"]+)"|'([^']+)'|(\S+))/);
      const textMatch = command.match(/--text=(?:"([^"]+)"|'([^']+)'|(\S+))/);

      if (!pathMatch) {
        return '❌ Format salah. Gunakan: sendFile --pathfile="./namafile.txt" --text="Caption"';
      }

      const rawPath = pathMatch[1] || pathMatch[2] || pathMatch[3];
      const caption = textMatch ? (textMatch[1] || textMatch[2] || textMatch[3]) : "";
      const absolutePath = resolveWorkspacePath(rawPath);

      if (!fs.existsSync(absolutePath)) {
        return `❌ File tidak ditemukan: '${rawPath}'`;
      }

      const results = await sendFileToUser(session_id, absolutePath, caption);
      return results.join("\n");
    }

    const risk = classifyRisk(command);
    if (risk.level === "high") {
      return `🚫 Perintah diblokir permanen (risiko TINGGI: ${risk.reason}): "${command}"`;
    }
    if (risk.level === "medium" && !confirm_risky) {
      return (
        `⚠️ Perintah ini terdeteksi berisiko (${risk.reason}) dan TIDAK dijalankan.\n` +
        `Command: "${command}"\n\n` +
        `Kalau ini memang disengaja dan sudah dikonfirmasi user, panggil ulang tool bash dengan confirm_risky:true.`
      );
    }

    // ── TERMINAL BACKENDS ────────────────────────────────────────────
    let prefixCmd = command;
    let workDir = resolveCwd(cwd);
    if (backend !== "local") {
      let be;
      try {
        const backends = JSON.parse(fs.readFileSync(".emora/backends.json", "utf8"));
        be = backends[backend];
      } catch { /* belum ada file */ }
      if (!be) {
        return `❌ Backend SSH "${backend}" tidak ditemukan di .emora/backends.json. Format: { "${backend}": { "host": "...", "user": "...", "port": 22 } }`;
      }
      const port = be.port || 22;
      const target = `${be.user}@${be.host}`;
      const remoteCmd = cwd ? `cd '${cwd}' && ${command}` : command;
      prefixCmd = `ssh -o StrictHostKeyChecking=accept-new -p ${port} ${target} ${JSON.stringify(remoteCmd)}`;
      workDir = BASE_DIR;
    }

    const lines = [
      `💻 $ ${command}`,
      `🖥️ Backend: ${backend}`,
      ...(backend === "local" ? [`📁 CWD: ${path.relative(process.cwd(), workDir) || "."}`] : []),
      ``,
    ];

    try {
      const isWin = os.platform() === "win32";
      const shellCmd = isWin ? "cmd.exe" : "bash";
      const shellArgs = isWin ? ["/c", prefixCmd] : ["-c", prefixCmd];

      const result = await new Promise((resolve) => {
        const child = spawn(shellCmd, shellArgs, {
          cwd: workDir,
          env: { ...process.env, FORCE_COLOR: "0" },
        });

        const jobId = Math.random().toString(36).substring(2, 10);
        activeBashJobs[jobId] = { command: prefixCmd, pid: child.pid, startTime: Date.now() };

        let stdout = "";
        let stderr = "";
        let isTimedOut = false;

        const timer = setTimeout(() => {
          isTimedOut = true;
          child.kill("SIGTERM");
        }, timeout);

        child.stdout.on("data", (data) => {
          if (stdout.length < MAX_OUTPUT * 2) {
            stdout += data.toString();
          }
        });

        child.stderr.on("data", (data) => {
          if (stderr.length < MAX_OUTPUT * 2) {
            stderr += data.toString();
          }
        });

        child.on("error", (err) => {
          delete activeBashJobs[jobId];
          clearTimeout(timer);
          resolve({ stdout, stderr, code: -1, error: err });
        });

        child.on("close", (code) => {
          delete activeBashJobs[jobId];
          clearTimeout(timer);
          if (isTimedOut) {
            resolve({ stdout, stderr, code: -1, error: { code: "ETIMEDOUT", message: "Timeout" } });
          } else {
            resolve({ stdout, stderr, code: code ?? -1, error: null });
          }
        });
      });

      const stdoutStr = (result.stdout ?? "").trim();
      const stderrStr = (result.stderr ?? "").trim();
      const code = result.code;

      if (stdoutStr) {
        lines.push("📤 Output:");
        lines.push(stdoutStr.length > MAX_OUTPUT ? stdoutStr.slice(0, MAX_OUTPUT) + "\n…(dipotong)" : stdoutStr);
      }

      if (stderrStr) {
        lines.push(stdoutStr ? "\n⚠️ Stderr:" : "⚠️ Stderr:");
        lines.push(stderrStr.length > MAX_OUTPUT ? stderrStr.slice(0, MAX_OUTPUT) + "\n…(dipotong)" : stderrStr);
      }

      if (result.error) {
        if (result.error.code === "ETIMEDOUT") lines.push(`⏱️ Timeout setelah ${timeout / 1000} detik.`);
        else lines.push(`❌ Error: ${result.error.message}`);
        return lines.join("\n");
      }

      lines.push(`\n${code === 0 ? "✅" : "⚠️"} Exit code: ${code}`);
      return lines.join("\n");

    } catch (err) {
      return `❌ bash gagal: ${err.message}`;
    }
  },
});

