import fs from "fs/promises";

import { z } from "zod";

import {
  DynamicStructuredTool,
} from "@langchain/core/tools";

import {
  resolveWorkspacePath,
} from "../utils/workspace.js";

export default new DynamicStructuredTool({
  name: "create_folder",

  description:
    "Membuat folder",

  schema: z.object({
    path: z.string(),
  }),

  async func({ path }) {
    const target =
      resolveWorkspacePath(
        path
      );

    await fs.mkdir(
      target,
      {
        recursive: true,
      }
    );

    return `Folder berhasil dibuat: ${path}`;
  },
});