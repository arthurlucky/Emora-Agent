/**
 * tools/subagent.js
 *
 * Universal sub-agent delegation tool (seperti Hermes Agent).
 * Spawn isolated agent dengan konteks terbatas untuk tugas spesifik:
 * - Research & analysis
 * - Code review
 * - Content generation
 * - Data processing
 * 
 * Keuntungan vs swarm_delegate.js yang lama:
 * - Tidak perlu pre-configure container
 * - Lebih sederhana (in-memory, tidak persistent)
 * - Instruksi & personality bisa di-inject per-call
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createLLM } from "../provider/index.js";
import { ChatPromptTemplate } from "@langchain/core/prompts";

async function delegateToSubagent({ task, role = "assistant", context = "", maxTokens = 4000 }) {
  try {
    // Create isolated LLM (no tools by default untuk prevent recursion)
    const llm = await createLLM([]);

    const systemPrompt = `Kamu adalah sub-agent yang ditugaskan untuk menyelesaikan tugas spesifik.

${role === "researcher" ? `ROLE: Research Assistant
- Fokus pada mengumpulkan informasi faktual
- Berikan sumber/referensi jika memungkinkan
- Struktur jawaban dengan jelas (bullet points, sections)
- Prioritaskan akurasi dan kelengkapan` : ""}

${role === "analyzer" ? `ROLE: Data Analyzer
- Analisis data/informasi yang diberikan secara sistematis
- Identifikasi pola, trend, dan insight penting
- Berikan kesimpulan yang actionable
- Gunakan format yang terstruktur` : ""}

${role === "writer" ? `ROLE: Content Writer
- Tulis konten yang engaging dan well-structured
- Perhatikan tone, style, dan target audience
- Gunakan markdown untuk formatting
- Pastikan konten bebas dari typo dan grammatical errors` : ""}

${role === "coder" ? `ROLE: Code Assistant
- Tulis kode yang clean, efficient, dan well-documented
- Ikuti best practices untuk bahasa/framework yang digunakan
- Sertakan inline comments untuk bagian kompleks
- Pastikan kode dapat dijalankan tanpa error` : ""}

${role === "reviewer" ? `ROLE: Code Reviewer
- Review kode secara kritis dan konstruktif
- Identifikasi bugs, security issues, dan performance problems
- Sarankan improvements yang spesifik
- Berikan rating (1-10) untuk code quality` : ""}

${context ? `\nKONTEKS TAMBAHAN:\n${context}\n` : ""}

ATURAN:
- Fokus HANYA pada tugas yang diberikan
- Jangan bertanya balik ke main agent (kamu tidak punya akses ke tools)
- Berikan output yang lengkap dan dapat langsung digunakan
- Jika informasi kurang, buat reasonable assumptions dan sebutkan
- Gunakan Bahasa Indonesia atau bahasa yang sesuai dengan task

TUGAS KAMU:`;

    const promptTemplate = ChatPromptTemplate.fromMessages([
      ["system", systemPrompt],
      ["user", "{task}"]
    ]);

    const chain = promptTemplate.pipe(llm);
    
    const response = await chain.invoke({ task });

    let result = '';
    if (response && typeof response.content === 'string') {
      result = response.content;
    } else if (response && response.text) {
      result = response.text;
    }

    return {
      success: true,
      role,
      result: result.trim(),
      tokensUsed: result.length // Rough estimate
    };

  } catch (err) {
    return {
      success: false,
      error: err.message,
      stack: err.stack
    };
  }
}

export const subagentTool = tool(
  async ({ task, role, context, maxTokens }) => {
    if (!task || task.trim().length === 0) {
      return "❌ Parameter 'task' wajib diisi dan tidak boleh kosong.";
    }

    const result = await delegateToSubagent({
      task,
      role: role || "assistant",
      context: context || "",
      maxTokens: maxTokens || 4000
    });

    if (!result.success) {
      return `❌ Sub-agent error: ${result.error}`;
    }

    return `✅ Sub-agent (${result.role}) selesai:\n\n${result.result}`;
  },
  {
    name: "delegate_to_subagent",
    description:
      "Delegasikan tugas kompleks ke sub-agent yang terisolasi. Sub-agent akan fokus " +
      "menyelesaikan tugas tanpa akses ke tools (untuk prevent infinite recursion). " +
      "Gunakan untuk: research, analysis, code review, content generation, data processing. " +
      "Sub-agent akan return hasil lengkap yang bisa langsung kamu gunakan.",
    schema: z.object({
      task: z.string().describe(
        "Tugas/instruksi lengkap untuk sub-agent. Harus jelas dan spesifik. " +
        "Contoh: 'Analisis code berikut dan identifikasi potential bugs: [code]'"
      ),
      role: z.enum(["assistant", "researcher", "analyzer", "writer", "coder", "reviewer"])
        .optional()
        .describe(
          "Role/personality sub-agent. Pilihan: assistant (default), researcher, " +
          "analyzer, writer, coder, reviewer. Role menentukan style & fokus jawaban."
        ),
      context: z.string().optional().describe(
        "Konteks tambahan yang perlu diketahui sub-agent (opsional). " +
        "Misal: project requirements, constraints, specific guidelines."
      ),
      maxTokens: z.number().optional().describe(
        "Max tokens untuk response (default 4000). Gunakan lebih kecil untuk task simpel."
      ),
    }),
  }
);

// Export standalone function
export { delegateToSubagent };

export default subagentTool;
