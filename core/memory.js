import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MEMORY_DIR = path.join(__dirname, '..', 'memory');

// Pastikan folder memory ada
import fsSync from 'fs';
if (!fsSync.existsSync(MEMORY_DIR)) {
  fsSync.mkdirSync(MEMORY_DIR, { recursive: true });
}

export async function loadSession(sessionId) {
  try {
    const file = path.join(MEMORY_DIR, `${sessionId}.json`);
    const content = await fs.readFile(file, "utf8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

export async function saveSession(sessionId, messages) {
  const file = path.join(MEMORY_DIR, `${sessionId}.json`);
  await fs.writeFile(
    file,
    JSON.stringify(messages, null, 2)
  );
}
