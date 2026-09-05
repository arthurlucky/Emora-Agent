import fs from "fs/promises";
import path from "path";

const SKILL_DIR = "./skill";

export async function evaluateAndExtractSkill({ sessionId, input, response, usedTools, envOverride }) {
  if (!usedTools || usedTools.length === 0) return;
  // Ignore trivial short tasks
  if (input.length < 20 && usedTools.length < 2) return;

  try {
    const { createLLM, detectProvider } = await import("../provider/index.js");
    const { emitSubagentEvent } = await import("./ag_subagent_engine.js");
    
    // Spawn background LLM
    const providerKey = process.env.MODEL_PROVIDER || detectProvider();
    const evaluatorLLM = await createLLM([], providerKey, {
      model: process.env.MODEL_NAME,
      apiKey: process.env.MODEL_API,
      url: process.env.MODEL_URL
    });

    const systemMsg = `Kamu adalah AI Code Reviewer & Auto-Skill Extractor.
Tugasmu adalah menganalisis interaksi User dan Assistant sebelumnya. 
Tentukan apakah respons dan tindakan Assistant merepresentasikan alur kerja (workflow) yang berharga, kompleks, atau reusable yang pantas dijadikan "Skill" standar AI Agent.

Kriteria Skill yang BAGUS:
1. Tidak terlalu sepele (contoh: jangan buat skill hanya untuk menyapa, ls, echo, atau baca 1 file).
2. Memecahkan masalah nyata dengan urutan langkah yang jelas (misal: "Refactor kode", "Setup CI/CD", "Ekstrak informasi dari Web ke Markdown").
3. Terfokus pada "Tugas/Goal", bukan sekadar urutan tools.

Jika hasilnya BAGUS, buatkan struktur file untuk skill baru.
Output harus HANYA berupa JSON (tanpa tag \`\`\`json):
{
  "is_good": true/false,
  "reason": "Alasan spesifik kenapa hasil ini layak/tidak dijadikan skill",
  "skill_name": "nama_skill_singkat",
  "skill_content": "---\\nname: nama_skill_singkat\\ndescription: Deskripsi singkat\\ncategories: productivity, devops\\n---\\n\\n# Panduan\\nInstruksi lengkap cara melakukan tugas ini...",
  "references": [
    { "filename": "context.md", "content": "Referensi tambahan jika perlu" }
  ],
  "script": "Script shell (.sh) opsional jika bisa diautomasi"
}`;

    const userMsg = `[USER PROMPT]\n${input}\n\n[ASSISTANT RESPONSE]\n${response}\n\n[TOOLS USED]\n${usedTools.join(", ")}`;

    const aiMsg = await evaluatorLLM.invoke([
       { role: "system", content: systemMsg },
       { role: "user", content: userMsg }
    ]);
    
    let text = typeof aiMsg.content === 'string' ? aiMsg.content : (aiMsg.content.map(c => c.text).join(''));
    text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    const result = JSON.parse(text);
    if (result.is_good && result.skill_name && result.skill_content) {
       const safeName = result.skill_name.toLowerCase().replace(/[^a-z0-9_]/g, '');
       const skillPath = path.join(SKILL_DIR, safeName);
       
       await fs.mkdir(skillPath, { recursive: true });
       await fs.writeFile(path.join(skillPath, "skill.md"), result.skill_content, "utf8");
       
       if (result.references && result.references.length > 0) {
          await fs.mkdir(path.join(skillPath, "references"), { recursive: true });
          for (const ref of result.references) {
             await fs.writeFile(path.join(skillPath, "references", ref.filename), ref.content, "utf8");
          }
       }
       
       if (result.script) {
          await fs.mkdir(path.join(skillPath, "scripts"), { recursive: true });
          await fs.writeFile(path.join(skillPath, "scripts", "run.sh"), result.script, "utf8");
          await fs.chmod(path.join(skillPath, "scripts", "run.sh"), 0o755).catch(()=>{});
       }
       
       const meta = {
         name: safeName,
         description: result.reason,
         source: "auto_evaluator",
         created_at: new Date().toISOString(),
         has_script: !!result.script,
         version: "1.0.0"
       };
       await fs.writeFile(path.join(skillPath, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
       
       emitSubagentEvent({
           type: "skill_extracted",
           subagentId: `evaluator_${Date.now()}`,
           role: "Code Reviewer",
           message: `🎉 Skill baru diekstrak dari tugas Anda: /${safeName} (Alasan: ${result.reason})`,
           status: "success"
       });
       
       const { invalidateSkillCache } = await import("./skillRegistry.js").catch(() => ({ invalidateSkillCache: ()=>{} }));
       invalidateSkillCache();
    }
  } catch(err) {
     // Silent fail for background tasks
  }
}
