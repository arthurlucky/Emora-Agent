import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { resolveWorkspacePath } from "../utils/workspace.js";

export default new DynamicStructuredTool({
  name: "project_manager",

  description:
    "Sistem Manajemen Proyek. Gunakan ini untuk membuat plan, melacak progress, dan menyimpan konteks. Ini menjaga agar kamu ingat urutan kerja dan isi file sebelumnya.",

  schema: z.object({
    action: z.enum(["create_plan", "get_status", "complete_task"]),
    project_name: z.string(),
    tasks: z.array(z.object({
      id: z.string().describe("ID unik, misal: 'task_1'"),
      description: z.string(),
      depends_on: z.array(z.string()).optional().describe("ID task lain yang wajib selesai sebelum ini bisa dikerjakan"),
    })).optional().describe("Isi saat action = create_plan"),
    task_id: z.string().optional().describe("ID task yang diselesaikan (saat action = complete_task)"),
    summary_context: z.string().optional().describe("Intisari data/kode dari task ini agar diingat di task berikutnya (saat action = complete_task)"),
  }),

  async func({ action, project_name, tasks, task_id, summary_context }) {
    const dbDir = resolveWorkspacePath(".emora_projects");
    const dbFile = path.join(dbDir, `${project_name}.json`); // Variabel ini sebelumnya hilang
    
    await fs.mkdir(dbDir, { recursive: true }).catch(() => {});

    try {
      if (action === "create_plan") {
        const plan = {
          project_name,
          tasks: tasks.map(t => ({ ...t, status: "PENDING", context: "" }))
        };
        await fs.writeFile(dbFile, JSON.stringify(plan, null, 2));
        return `✅ Plan "${project_name}" dibuat. Panggil action="get_status" untuk mulai eksekusi.`;
      }

      const planContent = await fs.readFile(dbFile, "utf-8");
      const plan = JSON.parse(planContent);

      if (action === "get_status") {
        const pending = plan.tasks.filter(t => t.status === "PENDING");
        const completed = plan.tasks.filter(t => t.status === "DONE");
        
        if (pending.length === 0) return `🎉 SEMUA TUGAS SELESAI. Beritahu pengguna.`;
        
        const readyTasks = pending.filter(t => {
          if (!t.depends_on || t.depends_on.length === 0) return true;
          return t.depends_on.every(depId => plan.tasks.find(pt => pt.id === depId)?.status === "DONE");
        });

        return `📊 STATUS: Selesai ${completed.length}, Sisa ${pending.length}\n\n🟢 TUGAS SIAP DIEKSEKUSI:\n${JSON.stringify(readyTasks, null, 2)}\n\n💡 KONTEKS SEBELUMNYA:\n${completed.map(c => `[${c.id}]: ${c.context}`).join("\n")}`;
      }

      if (action === "complete_task") {
        const taskIdx = plan.tasks.findIndex(t => t.id === task_id);
        if (taskIdx === -1) throw new Error("Task tidak ditemukan.");
        
        plan.tasks[taskIdx].status = "DONE";
        plan.tasks[taskIdx].context = summary_context || "Tidak ada konteks.";
        
        await fs.writeFile(dbFile, JSON.stringify(plan, null, 2));
        return `✅ Task "${task_id}" selesai. Panggil "get_status" lagi.`;
      }

    } catch (err) {
      return `❌ Error project_manager: ${err.message}`;
    }
  },
});
