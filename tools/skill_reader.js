import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";

const SKILLS_DIR = path.resolve("./skill");

/**
 * Mencari file skill.md dalam berbagai variasi kapitalisasi
 * @param {string} dirPath - Path ke direktori skill
 * @returns {Promise<string|null>} - Path file yang ditemukan atau null
 */
async function findSkillMd(dirPath) {
  try {
    const files = await fs.readdir(dirPath);
    // Cari file yang cocok dengan "skill.md" secara case-insensitive
    const skillMdFile = files.find(file => {
      if (file.toLowerCase() !== "skill.md") return false;
      // Verifikasi bahwa ini adalah file, bukan direktori
      const fullPath = path.join(dirPath, file);
      return fs.stat(fullPath).then(stat => stat.isFile()).catch(() => false);
    });
    
    return skillMdFile ? path.join(dirPath, skillMdFile) : null;
  } catch {
    return null;
  }
}

export const skillReaderTool = new DynamicStructuredTool({
  name: "read_skill",
  description: "WAJIB dipanggil pertama kali sebelum memulai coding project. Berguna untuk membaca panduan, pedoman, atau best-practice dari bahasa pemrograman tertentu.",
  schema: z.object({
    language: z.string().describe("Nama folder bahasa pemrograman (contoh: 'nodejs', 'python', 'react')"),
  }),
  async func({ language }) {
    try {
      const languageDir = path.join(SKILLS_DIR, language.toLowerCase());
      
      // Cek apakah direktori bahasa ada
      try {
        await fs.access(languageDir);
      } catch {
        return `❌ Direktori untuk '${language}' tidak ditemukan. Gunakan pengetahuan umummu.`;
      }

      // Cari file skill.md secara case-insensitive
      const skillPath = await findSkillMd(languageDir);
      
      if (!skillPath) {
        return `❌ File pedoman (skill.md) untuk '${language}' tidak ditemukan. Gunakan pengetahuan umummu.`;
      }

      const content = await fs.readFile(skillPath, "utf-8");
      return `📚 [PEDOMAN DITEMUKAN: ${language}]\n\n${content}`;
    } catch (err) {
      return `❌ Error membaca pedoman: ${err.message}`;
    }
  },
});