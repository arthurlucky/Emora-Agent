import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";

const execFilePromise = promisify(execFile);
const MAX_OUTPUT = 8 * 1024;

// Allowlist untuk ref/branch: tolak shell metachars, spasi, dan traversal.
const SAFE_BRANCH_RE = /^[A-Za-z0-9._/-]{1,100}$/;
const SHELL_META_RE = /[;&|*?~<>^()$`\\'"#\s]/;

function isSafeBranch(name) {
  if (!SAFE_BRANCH_RE.test(name)) return false;
  if (name.startsWith("-") || name.startsWith("/") || name.endsWith("/")) return false;
  if (name.includes("..") || name.includes("//")) return false;
  if (name.includes("@{")) return false; // reflog syntax
  return true;
}

function isSafePath(p) {
  if (typeof p !== "string" || p.length === 0 || p.length > 500) return false;
  if (p === ".") return true;
  // Tolak flag-like dan shell metachars kecuali pemisah path yang wajar.
  if (SHELL_META_RE.test(p) && p !== ".") {
    // Izinkan '/' '.' '_' '-' alfanumerik saja; selain itu tolak.
    if (!/^[A-Za-z0-9._/-]+$/.test(p)) return false;
  }
  if (p.startsWith("-")) return false;
  if (p.includes("..")) return false;
  return true;
}

async function runGit(args, cwd) {
  try {
    const { stdout, stderr } = await execFilePromise("git", args, {
      cwd: cwd || process.cwd(),
      timeout: 30_000,
      maxBuffer: MAX_OUTPUT * 4,
      // shell TIDAK dipakai — args diteruskan langsung ke git (anti-injeksi).
    });
    const out = `${stdout || ""}${stderr ? `\n[stderr] ${stderr}` : ""}`.trim();
    return (out || "Command executed successfully (no output).").slice(0, MAX_OUTPUT);
  } catch (error) {
    const out = `${error.stdout || ""}${error.stderr ? `\n${error.stderr}` : ""}`.trim();
    const hint = error.killed ? " (timeout 30s — coba scope lebih kecil)" : "";
    return `Git Error${hint}: ${(out || error.message).slice(0, MAX_OUTPUT)}`;
  }
}

export const gitManagerTool = new DynamicStructuredTool({
  name: "git_manager",
  description: "Manage Git version control via allowlisted args (no shell): status, add, commit, push, log, branch.",
  schema: z.object({
    action: z.enum(["status", "add", "commit", "push", "log", "branch"]).describe("The git action to perform"),
    files: z.array(z.string()).optional().describe("List of files to add (use ['.'] for all files)"),
    message: z.string().optional().describe("Commit message for the 'commit' action"),
    branch: z.string().optional().describe("Branch name for the 'push' or 'branch' action"),
  }),
  func: async ({ action, files, message, branch }) => {
    try {
      switch (action) {
        case "status":
          return await runGit(["status", "--short"]);
        case "add": {
          if (!files || files.length === 0) {
            return "Error: Please specify files to add. Contoh: files=['src/index.js'] atau files=['.'].";
          }
          if (files.length > 50) return "Error: Terlalu banyak file (>50). Pecah jadi beberapa panggilan.";
          for (const f of files) {
            if (!isSafePath(f)) {
              return `Error: Path tidak aman ditolak: '${f}'. Gunakan path relatif tanpa shell metachars, spasi, atau '..'. Contoh valid: 'src/a.js', '.'.`;
            }
          }
          // '--' memisahkan ref dari pathspec agar file bernama aneh tak jadi flag.
          return await runGit(["add", "--", ...files]);
        }
        case "commit": {
          if (!message || !message.trim()) {
            return "Error: Please provide a commit message. Contoh: message='fix: handle edge case'.";
          }
          if (message.length > 1000) return "Error: Commit message >1000 chars. Ringkas dulu.";
          return await runGit(["commit", "-m", message]);
        }
        case "push": {
          const targetBranch = branch || "main";
          if (!isSafeBranch(targetBranch)) {
            return `Error: Branch tidak aman ditolak: '${targetBranch}'. Gunakan huruf/angka/._/- saja (max 100), tanpa '..', spasi, atau shell metachars.`;
          }
          // Force-push diblokir di tool ini (risiko MEDIUM di riskClassifier).
          // Gunakan bash manual dengan confirm_risky jika benar-benar perlu.
          return await runGit(["push", "origin", targetBranch]);
        }
        case "log":
          return await runGit(["log", "-n", "5", "--oneline"]);
        case "branch": {
          if (!branch) return await runGit(["branch"]);
          if (!isSafeBranch(branch)) {
            return `Error: Branch tidak aman ditolak: '${branch}'. Gunakan huruf/angka/._/- saja.`;
          }
          return await runGit(["branch", branch]);
        }
        default:
          return "Error: Invalid action. Valid: status|add|commit|push|log|branch.";
      }
    } catch (error) {
      return `System Error: ${error.message}`;
    }
  },
});
