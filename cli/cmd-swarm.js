import chalk from "chalk";
import { createContainer, startContainer, stopContainer, listContainers } from "../swarm/manager.js";

export async function cmdSwarm(args) {
  const sub = args[0];
  const id = args[1];

  switch (sub) {
    case "create": {
      if (!id) return console.error(chalk.red("  ✗ Masukkan ID/Nama container. Contoh: emora swarm create agent-sales"));
      const res = await createContainer(id);
      console.log(res.success ? chalk.green(`  ✔ ${res.message}`) : chalk.red(`  ✗ ${res.message}`));
      console.log(chalk.gray(`  Folder: .emora/containers/${id}`));
      break;
    }
    case "start": {
      if (!id) return console.error(chalk.red("  ✗ Masukkan ID/Nama container."));
      console.log(chalk.cyan(`  Memulai container ${id}...`));
      const res = await startContainer(id);
      if (res.success) {
        console.log(chalk.green(`  ✔ Container berjalan di background (PID: ${res.pid})`));
      } else {
        console.log(chalk.red(`  ✗ Gagal: ${res.message}`));
      }
      break;
    }
    case "stop": {
      if (!id) return console.error(chalk.red("  ✗ Masukkan ID/Nama container."));
      const res = await stopContainer(id);
      if (res.success) {
        console.log(chalk.green(`  ✔ Container ${id} dihentikan.`));
      } else {
        console.log(chalk.red(`  ✗ Gagal: ${res.message}`));
      }
      break;
    }
    case "list": {
      console.log(chalk.bold.cyan("\n  Daftar Swarm Containers:\n"));
      const list = await listContainers();
      if (!list.length) {
        console.log(chalk.gray("  Tidak ada container. Gunakan `emora swarm create <id>` untuk membuat."));
        break;
      }
      for (const c of list) {
        const statusColor = c.status === "running" ? chalk.green("RUNNING") : chalk.gray("STOPPED");
        const pid = c.pid ? chalk.gray(`(PID: ${c.pid})`) : "";
        console.log(`  ● ${chalk.bold(c.id.padEnd(20))} ${statusColor} ${pid}`);
      }
      console.log("");
      break;
    }
    default: {
      console.log(chalk.bold("Usage:"));
      console.log("  emora swarm create <id>   " + chalk.gray("Buat agen/container baru"));
      console.log("  emora swarm start <id>    " + chalk.gray("Jalankan container (Gateway)"));
      console.log("  emora swarm stop <id>     " + chalk.gray("Hentikan container"));
      console.log("  emora swarm list          " + chalk.gray("Lihat daftar container"));
    }
  }
}
