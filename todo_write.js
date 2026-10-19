/**
 * tools/todo_write.js
 *
 * Task tracker terstruktur — analog `TodoWrite` di Claude Code. Belum ada
 * padanannya sama sekali di EMORA sebelumnya (lihat CHANGELOG.md); tanpa
 * ini, task multi-langkah tidak punya representasi eksplisit yang bisa
 * dilihat user selain membaca ulang teks jawaban model.
 *
 * KONTRAK (sengaja disamakan dengan Claude Code supaya familiar):
 *   - Setiap panggilan mengirim SELURUH daftar todo terbaru (bukan diff
 *     incremental) — state paling sederhana untuk dipahami & di-render.
 *   - Tiap item: { content, status, activeForm }.
 *       content:    deskripsi task dalam bentuk imperatif ("Perbaiki bug X")
 *       activeForm: bentuk present-continuous yang ditampilkan SAAT item
 *                   ini sedang dikerjakan ("Memperbaiki bug X")
 *       status:     "pending" | "in_progress" | "completed"
 *   - Maksimal SATU item boleh berstatus "in_progress" dalam satu waktu —
 *     ini mendorong agent fokus mengerjakan satu hal dulu sebelum lanjut,
 *     bukan membuka banyak task sekaligus tanpa menyelesaikan satupun.
 *
 * PENYIMPANAN: per-session di `.emora/todos/<sessionId>.json`, supaya
 * daftar tetap ada kalau user resume sesi yang sama nanti. TUI/webui bisa
 * merender ulang lebih rapi dengan membaca `getTodos(sessionId)`, tapi
 * SEKALIPUN tidak ada UI khusus, output tool ini sendiri sudah berupa
 * checklist teks yang enak dibaca di channel manapun (TUI/gateway/webui).
 */
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const TODO_ROOT = ".emora/todos";
const VALID_STATUS = ["pending", "in_progress", "completed"];

function todoFilePath(sessionId) {
  return path.join(TODO_ROOT, `${sessionId || "_default"}.json`);
}

export async function getTodos(sessionId) {
  try {
    const raw = await fs.readFile(todoFilePath(sessionId), "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveTodos(sessionId, todos) {
  const fp = todoFilePath(sessionId);
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(todos, null, 2));
}

const STATUS_ICON = { pending: "☐", in_progress: "▶", completed: "☑" };

function renderChecklist(todos) {
  if (!todos.length) return "(daftar todo kosong)";
  return todos
    .map((t) => {
      const icon = STATUS_ICON[t.status] || "☐";
      const label = t.status === "in_progress" && t.activeForm ? t.activeForm : t.content;
      return `${icon} ${label}`;
    })
    .join("\n");
}

export const todoWriteTool = new DynamicStructuredTool({
  name: "todo_write",
  description:
    "Buat/perbarui daftar task terstruktur (checklist) yang terlihat oleh user — untuk task MULTI-LANGKAH yang butuh 3+ tahap berbeda atau task kompleks yang perlu perencanaan. " +
    "JANGAN dipakai untuk task 1 langkah sederhana (overhead, bukan bantuan). " +
    "SELALU kirim SELURUH daftar terbaru tiap kali memanggil (bukan cuma item yang berubah). " +
    "Tandai SATU item sebagai in_progress SAAT kamu mulai mengerjakannya, lalu segera ubah ke completed SETELAH benar-benar selesai (jangan menumpuk banyak completed sekaligus di akhir — update secara real-time supaya user bisa lihat progress). " +
    "Maksimal satu item boleh in_progress dalam satu waktu.",
  schema: z.object({
    todos: z
      .array(
        z.object({
          content: z.string().describe("Deskripsi task, bentuk imperatif. Contoh: 'Perbaiki bug validasi form'"),
          activeForm: z.string().describe("Bentuk present-continuous, ditampilkan saat status in_progress. Contoh: 'Memperbaiki bug validasi form'"),
          status: z.enum(VALID_STATUS).describe("pending | in_progress | completed"),
        })
      )
      .describe("SELURUH daftar todo terbaru (replace total, bukan diff)."),
  }),
  func: async ({ todos }, config) => {
    const sessionId = config?.configurable?.sessionId || process.env.EMORA_SESSION_ID || "_default";

    const invalid = todos.find((t) => !VALID_STATUS.includes(t.status));
    if (invalid) return `❌ Status tidak valid: "${invalid.status}". Pilihan: ${VALID_STATUS.join(", ")}`;

    const inProgressCount = todos.filter((t) => t.status === "in_progress").length;
    if (inProgressCount > 1) {
      return `❌ Ditemukan ${inProgressCount} item berstatus in_progress. Maksimal 1 — selesaikan/pause yang lain dulu (jadikan pending) sebelum lanjut ke task berikutnya.`;
    }

    await saveTodos(sessionId, todos);

    const total = todos.length;
    const done = todos.filter((t) => t.status === "completed").length;
    const checklist = renderChecklist(todos);

    return `📋 Todo diperbarui (${done}/${total} selesai):\n${checklist}`;
  },
});

export default todoWriteTool;
