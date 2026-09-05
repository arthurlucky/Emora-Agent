import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { getEnv } from "./config.js";

const MEMORY_DIR = process.env.EMORA_MEMORY_DIR ? path.resolve(process.env.EMORA_MEMORY_DIR) : path.resolve("./memory");
const BACKUP_FILE = path.resolve("./memory_backup.enc");

// Derives a 32-byte key from the seed hash stored in .env
function getEncryptionKey() {
  const hash = getEnv("SEED_HASH");
  if (!hash) throw new Error("No seedphrase configured");
  return crypto.createHash("sha256").update(hash).digest();
}

export async function backupAndWipeMemory() {
  try {
    const files = await fs.readdir(MEMORY_DIR);
    const sessionFiles = files.filter(f => f.endsWith(".json"));
    
    if (sessionFiles.length === 0) return; // Nothing to backup

    const backupData = {};
    for (const f of sessionFiles) {
      const p = path.join(MEMORY_DIR, f);
      backupData[f] = await fs.readFile(p, "utf8");
    }

    const key = getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    
    let encrypted = cipher.update(JSON.stringify(backupData), "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");

    const finalPayload = JSON.stringify({
      iv: iv.toString("hex"),
      authTag,
      data: encrypted
    });

    await fs.writeFile(BACKUP_FILE, finalPayload, "utf8");

    // Wipe memory directory
    for (const f of sessionFiles) {
      await fs.unlink(path.join(MEMORY_DIR, f));
    }
  } catch (err) {
    console.error("Backup failed:", err);
  }
}

export async function restoreMemory(seedphrase) {
  const hash = crypto.createHash("sha256").update(seedphrase).digest("hex");
  if (hash !== getEnv("SEED_HASH")) {
    return false;
  }

  try {
    const raw = await fs.readFile(BACKUP_FILE, "utf8");
    const payload = JSON.parse(raw);
    
    const key = getEncryptionKey();
    const iv = Buffer.from(payload.iv, "hex");
    const authTag = Buffer.from(payload.authTag, "hex");
    
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(payload.data, "hex", "utf8");
    decrypted += decipher.final("utf8");
    
    const backupData = JSON.parse(decrypted);
    
    // Restore files
    await fs.mkdir(MEMORY_DIR, { recursive: true });
    for (const [filename, content] of Object.entries(backupData)) {
      await fs.writeFile(path.join(MEMORY_DIR, filename), content, "utf8");
    }
    
    // Remove backup
    await fs.unlink(BACKUP_FILE);
    return true;
  } catch (err) {
    console.error("Restore failed:", err);
    return false;
  }
}

export async function authenticate() {
  const hash = getEnv("SEED_HASH");
  if (!hash) return true; // Not configured

  const { input } = await import("../cli/select.js");
  const chalk = (await import("chalk")).default;

  console.log(chalk.yellow("\n🔒 EMORA is locked. Please enter your seedphrase."));
  
  for (let i = 0; i < 3; i++) {
    const attempt = await input("Seedphrase: ", "", true);
    const attemptHash = crypto.createHash("sha256").update(attempt.trim()).digest("hex");
    
    if (attemptHash === hash) {
      console.log(chalk.green("✅ Access granted.\n"));
      return true;
    } else {
      console.log(chalk.red(`❌ Incorrect. ${2 - i} attempts remaining.`));
    }
  }

  console.log(chalk.red("\n🚨 Maximum attempts reached. Initiating emergency backup and wipe..."));
  await backupAndWipeMemory();
  console.log(chalk.red("🚨 All sessions have been encrypted and wiped to protect your privacy."));
  console.log(chalk.red("🚨 You can restore them later by running setup again or using the correct seedphrase."));
  process.exit(1);
}
