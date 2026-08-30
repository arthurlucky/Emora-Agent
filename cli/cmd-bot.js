/**
 * cli/cmd-bot.js — `emora bot`
 * Kelola Bot Perusahaan, Peran, Warna, serta Delegasi Tugas Antar-Bot.
 */

import chalk from "chalk";
import { select, input, sectionHeader, sectionFooter, successLine, warnLine, errorLine } from "./select.js";
import { listBots, getBot, registerBot, removeBot, listGroups, createGroup } from "../core/botRegistry.js";

export async function cmdBot(args = []) {
  const sub = (args[0] || "list").toLowerCase();

  if (sub === "list") {
    sectionHeader("BOT ORGANISASI PERUSAHAAN", "Pecahan agent spesialis dengan peran & warna");
    const bots = await listBots();
    const groups = await listGroups();

    if (bots.length === 0) {
      console.log(chalk.gray("  Belum ada bot terdaftar. Ketik 'emora bot add' untuk membuat bot baru."));
    } else {
      for (const b of bots) {
        const badge = chalk.hex(b.color || "#58a6ff").bold(`[🤖 ${b.name}]`);
        console.log(`  ${badge} ${chalk.bold(b.name)} (ID: ${b.id})`);
        console.log(`     ${chalk.gray("Peran:")} ${b.role}`);
        console.log(`     ${chalk.gray("Tools:")} ${b.tools?.length ? b.tools.join(", ") : "semua tool"}`);
        console.log("");
      }
    }

    if (groups.length > 0) {
      console.log(chalk.bold("  🏢 Departemen / Grup Bot:"));
      for (const g of groups) {
        console.log(`  • ${chalk.bold(g.name)} (Leader: ${g.leaderBotId}) — ${g.botIds.length} bot`);
        console.log(`    ${chalk.gray(g.description)}`);
      }
    }
    sectionFooter();
    return;
  }

  if (sub === "add" || sub === "create") {
    sectionHeader("TAMBAH BOT PERUSAHAAN BARU", "Buat pecahan agent spesialis dengan peran & warna");

    const name = await input("Nama Bot (mis. SecurityBot, DesignBot):");
    if (!name) return errorLine("Nama bot tidak boleh kosong.");

    const role = await input("Peran / Persona (mis. Expert Security Auditor & Penetration Tester):");
    if (!role) return errorLine("Peran bot tidak boleh kosong.");

    const colorChoices = [
      { label: "🔵 Cyan (#58a6ff)", value: "#58a6ff" },
      { label: "🟢 Hijau (#3fb950)", value: "#3fb950" },
      { label: "🟣 Ungu (#a371f7)", value: "#a371f7" },
      { label: "🟡 Emas (#d29922)", value: "#d29922" },
      { label: "🔴 Merah (#f85149)", value: "#f85149" },
      { label: "🎨 Custom Hex Code...", value: "__custom__" },
    ];

    let chosenColor = await select("Pilih Warna Bot (Coloris):", colorChoices);
    if (chosenColor === "__custom__") {
      chosenColor = await input("Masukkan Kode Hex Warna (mis. #ff5722):", "#58a6ff");
    }

    const bot = await registerBot({ name, role, color: chosenColor });
    successLine(`Bot "${bot.name}" (ID: ${bot.id}) berhasil dibuat dengan warna ${bot.color}!`);
    sectionFooter();
    return;
  }

  if (sub === "rm" || sub === "remove" || sub === "delete") {
    const target = args[1];
    if (!target) return errorLine("Gunakan: emora bot rm <id_bot_atau_nama>");
    try {
      await removeBot(target);
      successLine(`Bot "${target}" berhasil dihapus.`);
    } catch (e) {
      errorLine(e.message);
    }
    return;
  }

  if (sub === "run" || sub === "delegate") {
    const botId = args[1];
    const task = args.slice(2).join(" ");

    if (!botId || !task) {
      return errorLine("Gunakan: emora bot run <bot_id> <deskripsi_tugas>");
    }

    const bot = await getBot(botId);
    if (!bot) return errorLine(`Bot "${botId}" tidak ditemukan. Cek: emora bot list`);

    sectionHeader(`DELEGASI TUGAS KE ${bot.name.toUpperCase()}`, `Role: ${bot.role}`);
    const colorFn = chalk.hex(bot.color || "#58a6ff").bold;
    console.log(colorFn(`  [🤖 ${bot.name}] Menerima tugas: "${task}"\n`));

    const { botMeshTool } = await import("../tools/bot_mesh.js");
    const result = await botMeshTool.invoke({ action: "delegate_task", bot_id: bot.id, task });

    console.log(result);
    sectionFooter();
    return;
  }

  console.log(chalk.gray("Sub-command tidak dikenal. Gunakan: list | add | rm <id> | run <bot_id> <tugas>"));
}

export default cmdBot;
