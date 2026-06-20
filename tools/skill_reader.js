import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";

const SKILLS_DIR = path.resolve("./skill");

export const skillReaderTool = new DynamicStructuredTool({
  name: "read_skill",
  description: "WAJIB dipanggil pertama kali sebelum memulai coding project. Berguna untuk membaca panduan, pedoman, atau best-practice dari bahasa pemrograman tertentu.",
  schema: z.object({
    language: z.string().describe("Nama folder bahasa pemrograman (contoh: 'nodejs', 'python', 'react')"),
  }),
  async func({ language }) {
    try {
      const skillPath = path.join(SKILLS_DIR, language.toLowerCase(), "skill.md");
      
      // Cek apakah file ada
      try {
        await fs.access(skillPath);
      } catch {
        return `❌ Pedoman untuk '${language}' tidak ditemukan di ${skillPath}. Gunakan pengetahuan umummu.`;
      }

      const content = await fs.readFile(skillPath, "utf-8");
      return `📚 [PEDOMAN DITEMUKAN: ${language}]\n\n${content}`;
    } catch (err) {
      return `❌ Error membaca pedoman: ${err.message}`;
    }
  },
});
