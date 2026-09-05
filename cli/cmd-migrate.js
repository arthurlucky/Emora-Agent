/**
 * cli/cmd-migrate.js
 *
 * Command untuk cek status memory system (memoryDB.js sudah di-deprecate).
 */

import chalk from "chalk";
import fs from "fs";
import path from "path";

const cyan = chalk.hex("#58a6ff");
const green = chalk.hex("#3fb950");
const dim = chalk.hex("#6e7681");

export async function cmdMigrate() {
  console.log();
  console.log(cyan.bold("  📦 Migrasi/Verifikasi Memory System"));
  console.log(dim("  ─".repeat(60)));
  console.log();

  const memoryDir = process.env.EMORA_MEMORY_DIR || path.resolve("./memory");
  const exists = fs.existsSync(memoryDir);

  console.log();
  console.log(green.bold("  ✅ System ready!"));
  console.log();
  console.log(dim("  Database type: ") + green("JSON enhanced (core/memory.js)"));
  console.log(dim("  Memory dir: ") + green(memoryDir));
  console.log(dim("  Status: ") + green(exists ? "operational" : "empty (will be created on first chat)"));
  console.log(dim("  Note: ") + dim("memoryDB.js sudah di-deprecate, semua operasi via memory.js + sessionStore.js"));
  console.log();
}
