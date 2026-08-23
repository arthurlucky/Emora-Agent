/**
 * tools/title_generator.js
 *
 * Sub-agent untuk generate judul conversation yang bermakna dari prompt awal.
 * Digunakan otomatis oleh sistem setiap sesi baru dimulai (untuk mengganti
 * "Sesi baru" / "tanpa judul" dengan sesuatu yang deskriptif).
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createLLM } from "../provider/index.js";
import { ChatPromptTemplate } from "@langchain/core/prompts";

async function generateTitle(prompt) {
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
    return null;
  }

  try {
    // Create a lightweight LLM instance (no tools, simple model)
    const llm = await createLLM([]);

    const systemPrompt = `Kamu adalah asisten yang bertugas membuat judul singkat untuk percakapan.

ATURAN:
1. Buat judul yang SANGAT SINGKAT (maksimal 40 karakter)
2. Harus deskriptif dan menangkap TOPIK UTAMA dari prompt
3. Gunakan Bahasa Indonesia atau bahasa yang sesuai dengan prompt
4. JANGAN gunakan tanda kutip di awal atau akhir
5. JANGAN awali dengan kata "Judul:", "Topik:", dll
6. Format: langsung judul saja, tanpa penjelasan tambahan

CONTOH:
Prompt: "Buatkan saya aplikasi todo list dengan React"
Judul: Aplikasi Todo List React

Prompt: "Jelaskan cara kerja quantum computing"
Judul: Penjelasan Quantum Computing

Prompt: "What's the weather like today?"
Judul: Weather Inquiry

Sekarang buat judul untuk prompt berikut:`;

    const promptTemplate = ChatPromptTemplate.fromMessages([
      ["system", systemPrompt],
      ["user", "{prompt}"]
    ]);

    const chain = promptTemplate.pipe(llm);
    
    const response = await chain.invoke({
      prompt: prompt.slice(0, 500) // Limit untuk efficiency
    });

    let title = '';
    if (response && typeof response.content === 'string') {
      title = response.content.trim();
    } else if (response && response.text) {
      title = response.text.trim();
    }

    // Clean up title
    title = title
      .replace(/^["']|["']$/g, '') // Remove quotes
      .replace(/^(judul|topik|title|subject):\s*/i, '') // Remove prefixes
      .replace(/\n.*/s, '') // Take only first line
      .trim();

    // Validate length
    if (title.length > 45) {
      title = title.slice(0, 42) + '...';
    }

    if (title.length < 3) {
      return null;
    }

    return title;

  } catch (err) {
    console.error('[title_generator] Error:', err.message);
    return null;
  }
}

export const titleGeneratorTool = tool(
  async ({ prompt }) => {
    if (!prompt) {
      return "❌ Parameter 'prompt' wajib diisi.";
    }

    const title = await generateTitle(prompt);
    
    if (!title) {
      return "⚠️ Gagal generate judul (prompt terlalu pendek atau error).";
    }

    return `✅ Judul yang disarankan: "${title}"`;
  },
  {
    name: "generate_conversation_title",
    description:
      "Generate judul singkat dan deskriptif untuk sebuah conversation berdasarkan prompt awal. " +
      "Digunakan untuk mengganti judul default 'Sesi baru' dengan sesuatu yang bermakna.",
    schema: z.object({
      prompt: z.string().describe("Prompt/pesan awal user yang ingin dibuatkan judul."),
    }),
  }
);

// Export standalone function untuk digunakan tanpa tool wrapper
export { generateTitle };

export default titleGeneratorTool;
