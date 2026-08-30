/**
 * core/swarmEngine.js
 *
 * Swarm Parallel Subagent Mesh Engine untuk EMORA Agent (/swarm).
 * Membelah tugas kompleks menjadi sub-tugas independen dan mengeksekusinya
 * secara PARALEL SERENTAK (concurrently via Promise.all) menggunakan
 * sub-agent spesialis (researcher, coder, reviewer, writer).
 */
import { delegateToSubagent } from "../tools/subagent.js";

export async function runSwarmMesh(taskPrompt) {
  if (!taskPrompt || !taskPrompt.trim()) {
    return "❌ Berikan deskripsi tugas untuk swarm. Contoh: /swarm buatkan REST API auth + docs";
  }

  const prompt = taskPrompt.trim();

  // Decompose task into 3 specialized sub-agent roles:
  // 1. Researcher / Planner
  // 2. Coder / Developer
  // 3. Reviewer / QA Specialist

  const subagents = [
    {
      role: "researcher",
      name: "🔍 Agent-Planner",
      task: `Rencanakan struktur & kebutuhan teknis untuk tugas berikut: ${prompt}. Tuliskan dalam bentuk rincian arsitektur & daftar file.`,
    },
    {
      role: "coder",
      name: "⚡ Agent-Developer",
      task: `Implementasikan kode utama untuk tugas berikut: ${prompt}. Tuliskan kode bersih, lengkap, dan modular.`,
    },
    {
      role: "reviewer",
      name: "🧪 Agent-QA",
      task: `Tuliskan test plan, rekomendasi penanganan error, dan audit keamanan untuk tugas berikut: ${prompt}.`,
    },
  ];

  const startTime = Date.now();

  // EXEKUSI PARALEL SERENTAK MENGGUNAKAN Promise.all
  const results = await Promise.all(
    subagents.map(async (sa) => {
      const res = await delegateToSubagent({
        task: sa.task,
        role: sa.role,
        context: prompt,
      });
      return { ...sa, result: res.success ? res.result : `Error: ${res.error}` };
    })
  );

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

  const output = [
    `🐝 [SWARM PARALLEL MESH COMPLETED — ${durationSec}s]`,
    `Tugas Utama: "${prompt}"`,
    `Status: 3/3 Sub-Agent Paralel Selesai`,
    `──────────────────────────────────────────────────────────────────────────────`,
  ];

  results.forEach((r) => {
    output.push(`\n### ${r.name} (${r.role})\n${r.result}\n`);
  });

  output.push(`──────────────────────────────────────────────────────────────────────────────`);
  output.push(`✨ Hasil gabungan dari seluruh Swarm Sub-Agent paralel siap digunakan.`);

  return output.join("\n");
}

export default { runSwarmMesh };
