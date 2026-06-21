import fs from "fs";
import readline from "readline/promises";
import chalk from "chalk";
import ora from "ora";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// ==========================================
// HELPERS .env
// ==========================================
const ENV_PATH = "./.env";

function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return "";
  return fs.readFileSync(ENV_PATH, "utf8");
}

function updateEnv(envContent, key, value) {
  const regex = new RegExp(`^${key}=.*$`, "m");
  if (regex.test(envContent)) {
    return envContent.replace(regex, `${key}=${value}`);
  } else {
    const prefix = envContent.endsWith("\n") || envContent === "" ? "" : "\n";
    return `${envContent}${prefix}${key}=${value}`;
  }
}

function saveToEnv(key, value) {
  let envContent = readEnv();
  envContent = updateEnv(envContent, key, value);
  fs.writeFileSync(ENV_PATH, envContent.trim() + "\n");
}

async function promptMenu(question, validOptions) {
  while (true) {
    const answer = (await rl.question(question)).trim();
    if (validOptions.includes(answer)) return answer;
    console.log(chalk.red("Pilihan tidak valid, silakan coba lagi.\n"));
  }
}

// ==========================================
// SETUP PROVIDER AI
// ==========================================
async function setupProvider() {
  console.log(chalk.bold("\n--- Pilih Provider AI ---"));
  console.log(`  1. Groq             [${chalk.green("GRATIS")}]`);
  console.log(`  2. NVIDIA NIM       [${chalk.green("GRATIS")}]`);
  console.log(`  3. OpenRouter       [${chalk.green("GRATIS")}]`);
  console.log(`  4. Google Gemini    [${chalk.green("GRATIS")}]`);
  console.log(`  5. OpenAI           [${chalk.red("BAYAR")}]`);
  console.log(`  6. Ollama (Local)   [${chalk.green("GRATIS")}] ⚡ ${chalk.yellow("Rekomendasi")}`);

  const providerChoice = await promptMenu(
    chalk.white.bold("\nMasukkan nomor pilihan Anda (1-6): "),
    ["1", "2", "3", "4", "5", "6"]
  );

  let modelUrl = "";
  let modelApi = "";
  let modelName = "";

  if (providerChoice !== "6") {
    modelApi = await rl.question(chalk.yellow("Masukkan API Key Anda: "));

    switch (providerChoice) {
      case "1":
        modelUrl = "https://api.groq.com/openai/v1";
        modelName =
          (await rl.question(chalk.yellow("Masukkan Model (default: llama-3.3-70b-versatile): "))) ||
          "llama-3.3-70b-versatile";
        break;
      case "2":
        modelUrl = "https://integrate.api.nvidia.com/v1";
        modelName =
          (await rl.question(chalk.yellow("Masukkan Model (default: meta/llama-3.1-70b-instruct): "))) ||
          "meta/llama-3.1-70b-instruct";
        break;
      case "3":
        modelUrl = "https://openrouter.ai/api/v1";
        modelName = await rl.question(chalk.yellow("Masukkan Model (contoh: google/gemini-2.5-pro): "));
        break;
      case "4":
        modelUrl = "https://generativelanguage.googleapis.com/v1beta/openai/";
        modelName =
          (await rl.question(chalk.yellow("Masukkan Model (default: gemini-1.5-pro): "))) || "gemini-1.5-pro";
        break;
      case "5":
        modelUrl = "https://api.openai.com/v1";
        modelName = (await rl.question(chalk.yellow("Masukkan Model (default: gpt-4o): "))) || "gpt-4o";
        break;
    }
  } else {
    modelApi = "ollama";
    let host = await rl.question(chalk.yellow("Masukkan Ollama Host (default: http://localhost:11434): "));
    if (!host) host = "http://localhost:11434";
    host = host.replace(/\/$/, "");
    modelUrl = `${host}/v1`;

    const autoScan = await promptMenu(chalk.yellow("Auto scan model dari Ollama? (Y/N): "), ["y", "Y", "n", "N"]);

    if (autoScan.toLowerCase() === "y") {
      const spinner = ora("Scanning model di Ollama...").start();
      try {
        const response = await fetch(`${host}/api/tags`);
        if (!response.ok) throw new Error("Gagal mengambil data dari Ollama");

        const data = await response.json();
        const models = data.models.map((m) => m.name);

        if (models.length === 0) {
          spinner.fail("Tidak ada model ditemukan di Ollama Anda.");
          modelName = await rl.question(chalk.yellow("Masukkan nama Ollama Model manual: "));
        } else {
          spinner.succeed(`Ditemukan ${models.length} model!`);
          models.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));

          const index = await promptMenu(
            chalk.white.bold(`Pilih nomor model (1-${models.length}): `),
            models.map((_, i) => (i + 1).toString())
          );
          modelName = models[parseInt(index) - 1];
        }
      } catch (err) {
        spinner.fail(chalk.red("Gagal terhubung ke Ollama. Pastikan aplikasi Ollama sedang berjalan."));
        modelName = await rl.question(chalk.yellow("Masukkan nama Ollama Model secara manual: "));
      }
    } else {
      modelName = await rl.question(chalk.yellow("Masukkan nama Ollama Model (contoh: llama3:8b): "));
    }

    const spinnerTest = ora(`Mengetes koneksi ke model ${modelName}...`).start();
    try {
      const testRes = await fetch(`${host}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelName }),
      });
      if (testRes.ok) {
        spinnerTest.succeed(chalk.green("Ollama berhasil terhubung dan model tersedia!"));
      } else {
        spinnerTest.warn(chalk.yellow("Model mungkin tidak ditemukan atau belum didownload."));
      }
    } catch {
      spinnerTest.fail(chalk.red("Gagal terhubung ke Host Ollama saat melakukan test."));
    }
  }

  const spinnerSave = ora("Menyimpan konfigurasi Provider...").start();
  saveToEnv("MODEL_URL", modelUrl);
  saveToEnv("MODEL_API", modelApi);
  saveToEnv("MODEL_NAME", modelName);

  let currentEnv = readEnv();
  if (!currentEnv.includes("TAVILY_API_KEY")) {
    saveToEnv("TAVILY_API_KEY", "");
  }

  spinnerSave.succeed(chalk.green("Konfigurasi Provider AI berhasil disimpan!\n"));
}

// ==========================================
// SETUP GATEWAY
// ==========================================
async function setupGateway() {
  console.log(chalk.bold("\n--- Setup Gateway ---"));
  console.log("  1. Telegram");
  console.log("  2. WhatsApp (via Pairing Code)");
  console.log("  3. Keduanya (Telegram + WhatsApp)");
  console.log("  4. Lewati (Nonaktifkan semua gateway)");

  const gatewayChoice = await promptMenu(
    chalk.white.bold("\nPilih (1/2/3/4): "),
    ["1", "2", "3", "4"]
  );

  // ---- Reset semua gateway ----
  saveToEnv("TELEGRAM_GATEWAY", "false");
  saveToEnv("TELEGRAM_TOKEN_BOT", "");
  saveToEnv("WA_GATEWAY", "false");
  saveToEnv("WA_PHONE_NUMBER", "");

  // ---- Telegram ----
  if (gatewayChoice === "1" || gatewayChoice === "3") {
    console.log(chalk.bold("\n  [Telegram]"));
    const token = await rl.question(chalk.yellow("  Masukkan Token Bot Telegram: "));
    const allowed = await rl.question(chalk.yellow("Masukan id user kamu izin akses: "));
    saveToEnv("TELEGRAM_GATEWAY", "true");
    saveToEnv("TELEGRAM_TOKEN_BOT", token.trim());
    saveToEnv("TELEGRAM_ALLOWED_IDS", allowed.trim());
    console.log(chalk.green("  ✔ Konfigurasi Telegram selesai.\n"));
  }

  // ---- WhatsApp ----
  if (gatewayChoice === "2" || gatewayChoice === "3") {
    console.log(chalk.bold("\n  [WhatsApp]"));
    console.log(chalk.gray("  Koneksi menggunakan Pairing Code (tanpa scan QR)."));
    console.log(chalk.gray("  Format nomor: kode_negara + nomor tanpa 0 di depan."));
    console.log(chalk.gray("  Contoh: 6281234567890\n"));

    const phone = await rl.question(chalk.yellow("  Masukkan nomor WhatsApp Anda: "));
    console.log(chalk.gray("  Contoh: 6285xxxxxxx\n"));
    const allowed = await rl.question(chalk.yellow("Masukan nomor untuk izin akses: "));

    const phoneClean = phone.trim().replace(/\D/g, "");
    if (!phoneClean || phoneClean.length < 10) {
      console.log(chalk.red("  ⚠️  Nomor tidak valid. WhatsApp dinonaktifkan.\n"));
    } else {
      saveToEnv("WA_GATEWAY", "true");
      saveToEnv("WA_PHONE_NUMBER", phoneClean);
      saveToEnv("WA_ALLOWED_NUMBERS", allowed);
      console.log(chalk.green(`  ✔ Nomor WhatsApp disimpan: ${phoneClean}`));
      console.log(chalk.yellow("  ℹ️  Saat EMORA pertama kali dijalankan, Pairing Code akan muncul di terminal."));
      console.log(chalk.yellow("  ℹ️  Buka WhatsApp → Perangkat Tertaut → Tautkan Perangkat → Masukkan kode.\n"));
    }
  }

  if (gatewayChoice === "4") {
    console.log(chalk.gray("✔ Semua gateway dinonaktifkan.\n"));
  }

  const spinnerSave = ora("Menyimpan konfigurasi Gateway...").start();
  spinnerSave.succeed(chalk.green("Konfigurasi Gateway berhasil disimpan!\n"));
}

// ==========================================
// SETUP WEBUI
// ==========================================
async function setupWebUI() {
  console.log(chalk.bold("\n--- Setup WebUI ---"));

  const webuiChoice = await promptMenu(
    chalk.yellow("WebUI On? (y/n): "),
    ["y", "Y", "n", "N"]
  );

  let webuiStatus = "false";
  if (webuiChoice.toLowerCase() === "y") {
    webuiStatus = "true";
    console.log(chalk.green("✔ WebUI diaktifkan.\n"));
  } else {
    console.log(chalk.gray("✔ WebUI dinonaktifkan.\n"));
  }

  const spinnerSave = ora("Menyimpan konfigurasi WebUI...").start();
  saveToEnv("WEBUI", webuiStatus);
  spinnerSave.succeed(chalk.green("Konfigurasi WebUI berhasil disimpan!\n"));
}

// ==========================================
// MENU UTAMA
// ==========================================
async function setup() {
  console.clear();
  console.log(chalk.cyan.bold("╔════════════════════════════════╗"));
  console.log(chalk.cyan.bold("║    EMORA SETUP CONFIGURATION   ║"));
  console.log(chalk.cyan.bold("╚════════════════════════════════╝\n"));

  // Buat folder uploads/ jika belum ada
  if (!fs.existsSync("./uploads")) {
    fs.mkdirSync("./uploads", { recursive: true });
    console.log(chalk.gray("✔ Folder uploads/ dibuat.\n"));
  }

  let running = true;

  while (running) {
    console.log(chalk.bold("Menu Utama:"));
    console.log("  1. Provider AI");
    console.log("  2. Gateway (Telegram / WhatsApp)");
    console.log("  3. Keluar");

    const menuChoice = await promptMenu(
      chalk.white.bold("\nPilih menu (1-4): "),
      ["1", "2", "3", "4"]
    );

    switch (menuChoice) {
      case "1":
        await setupProvider();
        break;
      case "2":
        await setupGateway();
        break;
      case "3":
        running = false;
        console.log(chalk.cyan.bold("\nSetup selesai. Jalankan EMORA dengan: node main.js\n"));
        break;
    }
  }

  rl.close();
}

setup();
