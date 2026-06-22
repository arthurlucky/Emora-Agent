import fs   from "fs";
import path from "path";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { resolveWorkspacePath } from "../utils/workspace.js";

export const readFileTool = new DynamicStructuredTool({
  name       : "read_file",
  description: "Baca isi file.",
  schema     : z.object({
    path: z.string().describe(
      "Path file, contoh: 'notes.txt'"
    ),
  }),
  func: async ({ path: filename }) => {
    try {
      const fp = resolveWorkspacePath(filename);
      const content = fs.readFileSync(fp, "utf-8");
      return content.length
        ? `📄 Isi "${filename}":\n\`\`\`\n${content}\n\`\`\``
        : `📄 File "${filename}" kosong.`;
    } catch (err) {
      return `❌ Error: ${err.message}`;
    }
  },
});
