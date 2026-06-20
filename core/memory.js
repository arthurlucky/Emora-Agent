import fs from "fs/promises";
import path from "path";

const MEMORY_DIR = "./memory";

export async function loadSession(
  sessionId
) {
  try {
    const file = path.join(
      MEMORY_DIR,
      `${sessionId}.json`
    );

    const content =
      await fs.readFile(
        file,
        "utf8"
      );

    return JSON.parse(content);
  } catch {
    return [];
  }
}

export async function saveSession(
  sessionId,
  messages
) {
  const file = path.join(
    MEMORY_DIR,
    `${sessionId}.json`
  );

  await fs.writeFile(
    file,
    JSON.stringify(
      messages,
      null,
      2
    )
  );
}