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

const BLACKLIST = [
  /rm\s+-(?:r\s*-f|f\s*-r|rf|fr)\s+\/\*?(?!\S)/,
  /rm\s+-rf\s+~\//,          
  /:\(\)\s*\{.*fork/,        
  /dd\s+if=.*of=\/dev\//,    
  /mkfs\./,                  
  /shutdown/,
  /reboot/,
  /halt/,
  /poweroff/,
  />\s*\/dev\/sd/,           
  /chmod\s+777\s+\/(?!\S)/, 
  /passwd(?:\s|$)/,          
  /sudo\s+rm\s+-(?:r\s*-f|f\s*-r|rf|fr)\s+\/\*?(?!\S)/,
  /\beval\b/,
  /\b(?:bash|sh|zsh)\s+-c\b/,
  /\bpython(?:3)?\s+-c\b/,
  /\bperl\s+-e\b/,
  /\bruby\s+-e\b/
];

function isSafe(cmd) {
  return !BLACKLIST.some(pattern => pattern.test(cmd));
}

function resolveCwd(cwd) {
  if (!cwd) return BASE_DIR;
  return path.isAbsolute(cwd) ? cwd : path.resolve(BASE_DIR, cwd);
}

export const shellExecTool = new DynamicStructuredTool({
  name: "shell_exec",
  description:
    "Jalankan perintah terminal/shell nyata. BISA JUGA untuk kirim file ke user via Telegram ATAU WhatsApp (otomatis sesuai gateway aktif) menggunakan perintah khusus: sendFile --pathfile=\"...\" --text=\"...\"",
  schema: z.object({
    command: z.string(),
    session_id: z.string().describe("WAJIB DIISI dengan Session ID (dari [INFO SYSTEM]) HANYA JIKA menggunakan perintah sendFile!").optional(),
    cwd: z.string().describe("Working directory. Kosongkan untuk mengeksekusi di root project (Emora-Agent).").optional(),
    timeout: z.number().int().min(1000).max(MAX_TIMEOUT).optional(),
    create_cwd: z.boolean().optional().default(true),
    backend: z.string().describe("Backend eksekusi: 'local' (default) atau nama backend SSH dari .emora/backends.json (mis. 'myvps').").optional(),
  }),
  func: async ({ command, session_id, cwd, timeout = DEFAULT_TIMEOUT, create_cwd = true, backend = "local" }) => {

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

    if (!isSafe(command)) return `🚫 Perintah diblokir: "${command}"`;

    // ── TERMINAL BACKENDS ────────────────────────────────────────────
    // backend "local" = spawn langsung (default).
    // backend lain = SSH ke host yang terdaftar di .emora/backends.json:
    //   { "myvps": { "host": "1.2.3.4", "user": "root", "port": 22 } }
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
      // Bungkus command dengan ssh; cd dulu kalau cwd dispesifikkan.
      const remoteCmd = cwd ? `cd '${cwd}' && ${command}` : command;
      prefixCmd = `ssh -o StrictHostKeyChecking=accept-new -p ${port} ${target} ${JSON.stringify(remoteCmd)}`;
      workDir = BASE_DIR; // ssh jalan dari lokal
    }

    const lines = [
      `💻 $ ${command}`,
      `🖥️ Backend: ${backend}`,
      ...(backend === "local" ? [`📁 CWD: ${path.relative(process.cwd(), workDir) || "."}`] : []),
      ``,
    ];

    try {
      // 🟢 DETEKSI OS OTOMATIS & ASYNCHRONOUS EXECUTOR
      const isWin = os.platform() === "win32";
      const shellCmd = isWin ? "cmd.exe" : "bash";
      const shellArgs = isWin ? ["/c", prefixCmd] : ["-c", prefixCmd];

      const result = await new Promise((resolve) => {
        const child = spawn(shellCmd, shellArgs, {
          cwd: workDir,
          env: { ...process.env, FORCE_COLOR: "0" },
        });

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
          clearTimeout(timer);
          resolve({ stdout, stderr, code: -1, error: err });
        });

        child.on("close", (code) => {
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
      return `❌ shell_exec gagal: ${err.message}`;
    }
  },
});

