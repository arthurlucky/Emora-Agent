import fg from "fast-glob";

import { z } from "zod";

import {
  DynamicStructuredTool,
} from "@langchain/core/tools";

import {
  resolveWorkspacePath,
} from "../utils/workspace.js";

export default new DynamicStructuredTool({
  name: "find_folder",

  description:
    "Mencari folder berdasarkan nama",

  schema: z.object({
    name: z.string(),
  }),

  async func({ name }) {
    const root =
      resolveWorkspacePath();

    const dirs =
      await fg("**", {
        cwd: root,
        onlyDirectories: true,
        absolute: false,
      });

    const found =
      dirs.filter((dir) =>
        dir
          .toLowerCase()
          .includes(
            name.toLowerCase()
          )
      );

    return JSON.stringify(
      found,
      null,
      2
    );
  },
});