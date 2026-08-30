/**
 * cli/cmd-records.js — `emora records`
 * Kelola Vault Terenkripsi Kepribadian Pengguna (EMORA RECORDS).
 */

import chalk from "chalk";
import { select, input, sectionHeader, sectionFooter, successLine, warnLine, errorLine } from "./select.js";
import {
  PERSONALITY_CATEGORIES,
  isVaultInitialized,
  setMasterPassword,
  verifyMasterPassword,
  loadVault,
  saveVault,
} from "../core/recordsManager.js";

export async function cmdRecords(args = []) {
  const sub = (args[0] || "view").toLowerCase();

  if (sub === "setup") {
    sectionHeader("SETUP EMORA RECORDS VAULT", "Vault Kepribadian Terenkripsi (AES-256-GCM)");

    const pwd = await input("Masukkan Password Vault Master (min. 4 karakter):", "", true);
    if (!pwd || pwd.length < 4) {
      return errorLine("Password vault minimal 4 karakter.");
    }
    const pwdConfirm = await input("Konfirmasi Password Vault Master:", "", true);
    if (pwd !== pwdConfirm) {
      return errorLine("Konfirmasi password tidak cocok.");
    }

    setMasterPassword(pwd);
    successLine("Password EMORA RECORDS Vault berhasil diset!");
    sectionFooter();
    return;
  }

  if (sub === "view" || sub === "list") {
    sectionHeader("EMORA RECORDS — VAULT KEPRIBADIAN", "Membuka catatan kepribadian terenkripsi");

    if (!isVaultInitialized()) {
      warnLine("Vault kepribadian belum diinisialisasi. Ketik 'emora records setup' untuk membuat password vault.");
      sectionFooter();
      return;
    }

    const pwd = await input("Masukkan Password Vault Master:", "", true);
    if (!verifyMasterPassword(pwd)) {
      return errorLine("Password vault salah! Akses ditolak.");
    }

    try {
      const records = loadVault(pwd);
      console.log(chalk.bold("\n  🔐 ISI VAULT KEPRIBADIAN PENGGUNA (7 Dimensi):"));
      console.log(chalk.gray(`  Terakhir Diperbarui: ${records.lastUpdated || "Belum ada data"}\n`));

      let totalFacts = 0;

      for (const [key, categoryName] of Object.entries(PERSONALITY_CATEGORIES)) {
        const items = records[key] || [];
        totalFacts += items.length;
        console.log(`  ${chalk.cyan.bold("• " + categoryName)} (${items.length} catatan):`);

        if (items.length === 0) {
          console.log(chalk.gray("    (Belum ada fakta tercatat)"));
        } else {
          for (const item of items) {
            const confBadge = chalk.green(`[Keyakinan: ${Math.round(item.confidence * 100)}%]`);
            console.log(`    - ${chalk.bold(item.fact)} ${confBadge} ${chalk.gray("(" + item.updatedAt + ")")}`);
          }
        }
        console.log("");
      }

      successLine(`Total ${totalFacts} fakta kepribadian berhasil dibaca dari vault terenkripsi.`);
    } catch (e) {
      errorLine(`Gagal membaca vault: ${e.message}`);
    }
    sectionFooter();
    return;
  }

  if (sub === "reset") {
    sectionHeader("RESET EMORA RECORDS", "Hapus seluruh catatan kepribadian terenkripsi");
    if (!isVaultInitialized()) return warnLine("Vault belum diinisialisasi.");

    const pwd = await input("Masukkan Password Vault Master:", "", true);
    if (!verifyMasterPassword(pwd)) return errorLine("Password vault salah!");

    const confirmReset = await confirm("Yakin ingin mengosongkan seluruh vault kepribadian?", { default: false });
    if (confirmReset) {
      saveVault(pwd, {
        hobby: [], writingStyle: [], dreams: [], emotion: [],
        lovedOnes: [], trustedPeople: [], friends: [],
        lastUpdated: new Date().toISOString(),
      });
      successLine("Vault EMORA RECORDS berhasil dikosongkan.");
    }
    sectionFooter();
    return;
  }

  console.log(chalk.gray("Gunakan: emora records setup | view | reset"));
}

export default cmdRecords;
