import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

// Import fungsi dari gateway
import { handleSendFile } from "../gateway/telegram/sendfile.js";

const BASE_DIR = path.resolve(process.cwd());
const DEFAULT_TIMEOUT = 60_000;
const MAX_TIMEOUT = 300_000;
const MAX_OUTPUT = 8000; 

const BLACKLIST = [
  /rm\s+-rf\s+\/(?!\S)/,     
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
  /sudo\s+rm\s+-rf\s+\//,
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
    "Jalankan perintah terminal/shell nyata. BISA JUGA untuk kirim file ke telegram menggunakan perintah khusus: sendFile --pathfile=\"...\" --text=\"...\"",
  schema: z.object({
    command: z.string(),
    session_id: z.string().optional().describe("WAJIB DIISI dengan Session ID (dari [INFO SYSTEM]) HANYA JIKA menggunakan perintah sendFile!"),
    cwd: z.string().optional().describe("Working directory. Kosongkan untuk mengeksekusi di root project (Emora-Agent)."),
    timeout: z.number().int().min(1000).max(MAX_TIMEOUT).optional(),
    create_cwd: z.boolean().optional().default(true),
  }),
  func: async ({ command, session_id, cwd, timeout = DEFAULT_TIMEOUT, create_cwd = true }) => {
    
    // [INTERCEPTOR]: Cegat perintah sendFile ke Telegram
    if (command.trim().startsWith("sendFile")) {
      if (!session_id) return "❌ Gagal: parameter session_id WAJIB diisi untuk sendFile.";
      return await handleSendFile(command, session_id);
    }

    if (!isSafe(command)) return `🚫 Perintah diblokir: "${command}"`;

    const workDir = resolveCwd(cwd);

    if (create_cwd && !fs.existsSync(workDir)) {
      try { fs.mkdirSync(workDir, { recursive: true }); }
      catch (e) { return `❌ Gagal membuat direktori "${workDir}": ${e.message}`; }
    }

    if (!fs.existsSync(workDir)) return `❌ Direktori tidak ditemukan: "${workDir}"`;

    const lines = [
      `💻 $ ${command}`,
      `📁 CWD: ${path.relative(process.cwd(), workDir) || "."}`,
      ``,
    ];

    try {
      // 🟢 DETEKSI OS OTOMATIS
      const isWin = os.platform() === "win32";
      const shellCmd = isWin ? "cmd.exe" : "bash";
      const shellArgs = isWin ? ["/c", command] : ["-c", command];

      const result = spawnSync(shellCmd, shellArgs, {
        cwd: workDir,
        timeout,
        encoding: "utf-8",
        env: { ...process.env, FORCE_COLOR: "0" },
        maxBuffer: 10 * 1024 * 1024,
      });

      const stdout = (result.stdout ?? "").trim();
      const stderr = (result.stderr ?? "").trim();
      const code = result.status ?? -1;

      if (stdout) {
        lines.push("📤 Output:");
        lines.push(stdout.length > MAX_OUTPUT ? stdout.slice(0, MAX_OUTPUT) + "\n…(dipotong)" : stdout);
      }

      if (stderr) {
        lines.push(stdout ? "\n⚠️ Stderr:" : "⚠️ Stderr:");
        lines.push(stderr.length > MAX_OUTPUT ? stderr.slice(0, MAX_OUTPUT) + "\n…(dipotong)" : stderr);
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
