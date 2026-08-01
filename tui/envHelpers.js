/**
 * tui/envHelpers.js
 *
 * Sama persis dengan helper .env di setup.js (regex line-replace), supaya
 * TUI dan `emora setup` menyimpan .env dengan cara yang identik.
 */
import fs from "fs";

const ENV_PATH = "./.env";

export function readEnv() {
  if (!fs.existsSync(ENV_PATH)) return "";
  return fs.readFileSync(ENV_PATH, "utf8");
}

export function setEnv(key, value) {
  let content = readEnv();
  const regex = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  content = regex.test(content)
    ? content.replace(regex, line)
    : content + (content.endsWith("\n") || content === "" ? "" : "\n") + line;
  fs.writeFileSync(ENV_PATH, content.trim() + "\n");
  process.env[key] = value;
}

export function getEnv(key) {
  const match = readEnv().match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1].trim() : "";
}
