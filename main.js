import "dotenv/config";
import crypto from "crypto";
import readline from "readline/promises";

import chalk from "chalk";
import boxen from "boxen";
import figlet from "figlet";
import ora from "ora";

import { ChatOpenAI } from "@langchain/openai";
import tools from "./core/tools.js";
import { ask } from "./core/chat.js";
import { handleCommand } from "./core/cmd.js";
import { eventBus } from "./utils/eventBus.js";
import { activeGateways } from "./gateway/index.js"
// ==========================================
// INISIALISASI LLM BERDASARKAN .ENV
// ==========================================
const llm = new ChatOpenAI({
  apiKey: process.env.MODEL_API || "ollama",
  model: process.env.MODEL_NAME,
  configuration: { baseURL: process.env.MODEL_URL },
  temperature: 0.2,
  maxTokens: 2048,
}).bindTools(tools, { toolChoice: "auto" });

const state = {
  currentSession: crypto.randomUUID(),
};

// ==========================================
// DETEKSI MODE WEB UI
// `npm start --web` membuat npm mengeset env npm_config_web="true" secara
// otomatis (tanpa perlu `--`), jadi itu dicek juga selain WEBUI=true di .env
// dan flag --web langsung lewat `node main.js --web`.
// ==========================================
const WEB_MODE =
  process.env.WEBUI === "true" ||
  process.env.npm_config_web === "true" ||
  process.argv.includes("--web");

// ==========================================
// BACKGROUND TASK HANDLER (DENGAN LOCK & ISOLASI MEMORI)
// ==========================================
const bgLocks = {};

eventBus.on("execute_bg_task", async ({ job_id, session_id, prompt }) => {
  // Pengunci: Cegah bentrok jika AI masih memproses tugas interval sebelumnya
  if (bgLocks[job_id]) return; 
  bgLocks[job_id] = true;

  try {
    // Isolasi Memori: Gunakan session_id khusus agar memori obrolan utama tidak tercemar
    const bgSessionId = `${session_id}_bg_${job_id}`;
    
    const result = await ask(llm, tools, bgSessionId, `[BACKGROUND TASK] ${prompt}`);
    
    // Kirim notifikasi HANYA jika AI tidak membisu (SILENT_ABORT)
    if (!result.includes("SILENT_ABORT")) {
      console.log("\n" + boxen(chalk.yellow(result), { 
        title: "🔔 NOTIFIKASI BACKGROUND", 
        padding: 1, 
        borderColor: "yellow" 
      }) + "\n");
      
      // Kembalikan tampilan prompt
      process.stdout.write(
        chalk.gray("[") + chalk.green(state.currentSession.slice(0, 8)) + chalk.gray("] ") + chalk.bold.white("You") + chalk.gray(" > ")
      );
    }
  } catch (error) { 
    console.error(`\n[BG TASK ERROR CLI] Job ${job_id} gagal: ${error.message}`); 
  } finally {
    bgLocks[job_id] = false; // Buka kunci setelah selesai
  }
});


// ==========================================
// AUTO-START WEB UI
// ==========================================


if (WEB_MODE) {
  import("./webui/server.js").catch(err => {
  console.error(`\n[WEBUI ERROR] Gagal menjalankan Web UI: ${err.message}`);
});
}






function showBanner() {
  console.clear();
  const banner = figlet.textSync("EMORA", { font: "ANSI Shadow" });
  console.log(chalk.cyan.bold(banner));

  console.log(
    boxen(
      [
        chalk.bold("EMORA AI Assistant"),
        "",
        "/new",
        "/sesi",
        "/sesi <uuid>",
        "/help",
        "/exit",
      ].join("\n"),
      { padding: 1, borderStyle: "round", borderColor: "cyan" }
    )
  );

  console.log();
  console.log(chalk.gray("Session:"), chalk.green(state.currentSession));
  
  if (process.env.TELEGRAM_GATEWAY === "true") {
    console.log(chalk.green("📡 Telegram Gateway: AKTIF"));
  } else {
    console.log(chalk.gray("📡 Telegram Gateway: NONAKTIF"));
  }

  if (WEB_MODE) {
    const port = process.env.WEBUI_PORT || 5090;
    console.log(chalk.green(`🌐 Web UI: AKTIF (http://localhost:${port})`));
  } else {
    console.log(chalk.gray("🌐 Web UI: NONAKTIF (jalankan dengan: npm start --web)"));
  }
  console.log();
}

function printAI(text) {
  console.log();
  console.log(
    boxen(text, {
      title: chalk.bold.cyan(" EMORA "),
      titleAlignment: "left",
      padding: 1,
      borderStyle: "round",
      borderColor: "blue",
    })
  );
  console.log();
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function runChat() {
  showBanner();

  while (true) {
    const promptText = 
      chalk.gray("[") + chalk.green(state.currentSession.slice(0, 8)) + chalk.gray("] ") + chalk.bold.white("You") + chalk.gray(" > ");

    let input = await rl.question(promptText);
    input = input.trim();

    if (!input) continue;

    // Cek Command CLI (/new, /sesi, /exit, dll)
    const commandResult = handleCommand(input, state);
    if (commandResult) {
      if (commandResult.action === "exit") {
        console.log("\n" + chalk.yellow(commandResult.message) + "\n");
        process.exit(0);
      }
      if (commandResult.action === "reply") {
        console.log("\n" + boxen(chalk.green.bold(commandResult.message), { padding: 1, borderStyle: "round", borderColor: "green" }) + "\n");
      }
      continue;
    }

    const spinner = ora("EMORA sedang berpikir...").start();

    try {
      const result = await ask(llm, tools, state.currentSession, input);
      spinner.stop();
      printAI(result);
    } catch (err) {
      spinner.fail("Terjadi kesalahan pada sistem.");
      const errorMessage = err?.message || err?.error?.message || "Kesalahan tidak diketahui.";
      console.log(chalk.red(`\n[ERROR] ${errorMessage}\n`));
    }
  }
}

runChat();
