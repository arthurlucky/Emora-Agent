import fs from "fs/promises";

import { z } from "zod";

import {
  DynamicStructuredTool,
} from "@langchain/core/tools";

import {
  resolveWorkspacePath,
} from "../utils/workspace.js";

export default new DynamicStructuredTool({
  name: "delete_folder",

  description:
    "Menghapus folder",

  schema: z.object({
    path: z.string(),
  }),

  async func({ path }) {
    const target =
      resolveWorkspacePath(
        path
      );

    await fs.rm(
      target,
      {
        recursive: true,
        force: true,
      }
    );

    return `Folder berhasil dihapus: ${path}`;
  },
});