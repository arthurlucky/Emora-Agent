/**
 * cli/cmd-migrate.js
 *
 * Command untuk migrasi data dari JSON ke SQLite
 */

import chalk from "chalk";
import { migrateFromJSON } from "../core/memoryDB.js";

const cyan = chalk.hex("#58a6ff");
const green = chalk.hex("#3fb950");
const yellow = chalk.hex("#d29922");
const red = chalk.hex("#f85149");
const dim = chalk.hex("#6e7681");

export async function cmdMigrate() {
  console.log();
  console.log(cyan.bold("  📦 Migrasi/Verifikasi Memory System"));
  console.log(dim("  ─".repeat(60)));
  console.log();

  console.log(yellow("  ℹ️  Mengecek database system..."));
  console.log();

  try {
    const result = await migrateFromJSON();
    console.log();
    console.log(green.bold("  ✅ System ready!"));
    console.log();
    console.log(dim("  Database type: ") + green(result.type || 'JSON enhanced'));
    console.log(dim("  Status: ") + green("operational"));
    console.log();
    console.log(dim("  Langkah selanjutnya:"));
    console.log(dim("  1. Jalankan ") + cyan("emora") + dim(" untuk start"));
    console.log(dim("  2. Buat conversation dan cek fitur baru"));
    console.log();
  } catch (err) {
    console.error();
    console.error(red.bold("  ❌ System check gagal:"));
    console.error(red(`     ${err.message}`));
    console.error();
    console.error(dim("  Troubleshooting:"));
    console.error(dim("  - Pastikan memory/ folder ada dan writable"));
    console.error(dim("  - Check permission: ") + cyan("ls -la memory/"));
    console.error();
    process.exit(1);
  }
}
