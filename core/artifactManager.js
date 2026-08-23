/**
 * core/artifactManager.js
 *
 * Sistem Artifact untuk EMORA — sebelumnya EMORA tidak punya cara terstruktur
 * untuk menyimpan/mengelola output kerja (kode, dokumen, config, dst) di luar
 * riwayat chat biasa. Modul ini menambahkan artifact dengan versioning,
 * disimpan sebagai file JSON per artifact (konsisten dengan gaya EMORA yang
 * file-based, bukan SQLite seperti Elynisia).
 *
 * Struktur penyimpanan: ./artifacts/<sessionId>/<artifactId>.json
 *   { id, sessionId, name, type, version, content, metadata, history: [...] }
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { resolveWorkspacePath } from "../utils/workspace.js";

const ARTIFACTS_DIR = resolveWorkspacePath(".emora_artifacts");

export const ARTIFACT_TYPES = [
  "markdown", "html", "json", "mermaid", "svg", "source_code", "sql", "documentation", "report", "config",
];

function ensureDir() {
  if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

function artifactPath(id) {
  ensureDir();
  return path.join(ARTIFACTS_DIR, `${id}.json`);
}

function readArtifact(id) {
  const p = artifactPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeArtifact(artifact) {
  fs.writeFileSync(artifactPath(artifact.id), JSON.stringify(artifact, null, 2), "utf8");
}

export function createArtifact({ name, type = "markdown", content = "", metadata = {} }) {
  const id = `ART-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const now = Date.now();
  const artifact = {
    id,
    name,
    type: (type || "markdown").toLowerCase(),
    version: 1,
    content,
    metadata,
    createdAt: now,
    updatedAt: now,
    history: [{ version: 1, content, summary: "Inisialisasi awal artifact", createdAt: now }],
  };
  writeArtifact(artifact);
  return artifact;
}

export function getArtifact(id) {
  const artifact = readArtifact(id);
  if (!artifact) throw new Error(`Artifact "${id}" tidak ditemukan.`);
  return artifact;
}

export function listArtifacts() {
  ensureDir();
  return fs.readdirSync(ARTIFACTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const a = JSON.parse(fs.readFileSync(path.join(ARTIFACTS_DIR, f), "utf8"));
      return { id: a.id, name: a.name, type: a.type, version: a.version, updatedAt: a.updatedAt };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function updateArtifact(id, newContent, summary = "Update konten") {
  const artifact = getArtifact(id);
  const now = Date.now();
  artifact.version += 1;
  artifact.content = newContent;
  artifact.updatedAt = now;
  artifact.history.push({ version: artifact.version, content: newContent, summary, createdAt: now });
  writeArtifact(artifact);
  return artifact;
}

export function deleteArtifact(id) {
  const p = artifactPath(id);
  if (!fs.existsSync(p)) throw new Error(`Artifact "${id}" tidak ditemukan.`);
  fs.unlinkSync(p);
  return true;
}

export function getArtifactHistory(id) {
  return getArtifact(id).history;
}

export default {
  ARTIFACT_TYPES,
  createArtifact, getArtifact, listArtifacts, updateArtifact, deleteArtifact, getArtifactHistory,
};
