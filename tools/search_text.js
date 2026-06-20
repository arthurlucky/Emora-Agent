import fs from "fs/promises";
import fg from "fast-glob";

import { z } from "zod";

import {
  DynamicStructuredTool,
} from "@langchain/core/tools";

import {
  resolveWorkspacePath,
} from "../utils/workspace.js";

export default new DynamicStructuredTool({
  name: "search_text",

  description:
    "Mencari teks dalam seluruh file",

  schema: z.object({
    query: z.string(),
  }),

  async func({ query }) {
    const root =
      resolveWorkspacePath();

    const files =
      await fg("**/*", {
        cwd: root,
        absolute: true,
        onlyFiles: true,
      });

    const results = [];

    for (const file of files) {
      try {
        const content =
          await fs.readFile(
            file,
            "utf8"
          );

        const lines =
          content.split("\n");

        lines.forEach(
          (line, index) => {
            if (
              line.includes(query)
            ) {
              results.push({
                file,
                line:
                  index + 1,
                text:
                  line.trim(),
              });
            }
          }
        );
      } catch {}
    }

    return JSON.stringify(
      results.slice(0, 100),
      null,
      2
    );
  },
});