/**
 * Test untuk tools/undo.js — pakai node:test.
 * Flow: tulis file → undo → restored → redo → modified lagi.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import { recordSnapshot, undo, redo } from "../undo.js";

const TMP_DIR = path.join(process.cwd(), "tools/__tests__/tmp-undo");
const TEST_FILE = path.join(TMP_DIR, "test.txt");
const SESSION = "_test_" + Date.now();

process.env.EMORA_SESSION_ID = SESSION;

test("undo/redo: full cycle", async () => {
  // Setup: tulis seed file.
  await fs.mkdir(TMP_DIR, { recursive: true });
  const seed = "original content\nline2\n";
  await fs.writeFile(TEST_FILE, seed);

  // Snapshot + modify.
  await recordSnapshot(TEST_FILE, "write");
  await fs.writeFile(TEST_FILE, "modified content\n");

  // Undo → kembali ke seed.
  const u = await undo();
  assert.equal(u.ok, true);
  const restored = await fs.readFile(TEST_FILE, "utf-8");
  assert.equal(restored, seed);

  // Redo → kembali ke modified.
  const r = await redo();
  assert.equal(r.ok, true);
  const redone = await fs.readFile(TEST_FILE, "utf-8");
  assert.equal(redone, "modified content\n");
});

test("undo: nothing to undo returns error", async () => {
  // Session baru, stack kosong.
  process.env.EMORA_SESSION_ID = "_empty_" + Date.now();
  const r = await undo();
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("Nothing to undo"));
});

test("undo: delete file (snapshot of non-existent)", async () => {
  process.env.EMORA_SESSION_ID = "_delete_" + Date.now();
  const f = path.join(TMP_DIR, "doomed.txt");
  await fs.writeFile(f, "alive");
  await recordSnapshot(f, "write");
  await fs.unlink(f);  // simulate "delete after snapshot"
  const exists1 = await fs.stat(f).then(() => true).catch(() => false);
  assert.equal(exists1, false);

  const r = await undo();
  assert.equal(r.ok, true);
  const exists2 = await fs.stat(f).then(() => true).catch(() => false);
  assert.equal(exists2, true);
  const content = await fs.readFile(f, "utf-8");
  assert.equal(content, "alive");

  // Cleanup.
  await fs.unlink(f);
});

// Cleanup tmp dir setelah test.
test("cleanup", async () => {
  try { await fs.rm(TMP_DIR, { recursive: true, force: true }); } catch {}
});
