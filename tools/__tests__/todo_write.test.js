/**
 * Test untuk tools/todo_write.js — pakai node:test (built-in, no dep).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { todoWriteTool, getTodos } from "../todo_write.js";

// Jalankan test di cwd sementara supaya .emora/todos/ tidak nyampah di repo asli.
function withTempCwd(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "todo-write-test-"));
  const prevCwd = process.cwd();
  process.chdir(dir);
  return fn().finally(() => process.chdir(prevCwd));
}

test("todo_write: simpan & baca kembali daftar todo", async () => {
  await withTempCwd(async () => {
    const sessionId = "sess-1";
    const res = await todoWriteTool.func(
      {
        todos: [
          { content: "Tulis fungsi A", activeForm: "Menulis fungsi A", status: "in_progress" },
          { content: "Tulis test A", activeForm: "Menulis test A", status: "pending" },
        ],
      },
      { configurable: { sessionId } }
    );
    assert.ok(res.includes("0/2 selesai"));
    assert.ok(res.includes("▶ Menulis fungsi A"));
    assert.ok(res.includes("☐ Tulis test A"));

    const stored = await getTodos(sessionId);
    assert.equal(stored.length, 2);
    assert.equal(stored[0].status, "in_progress");
  });
});

test("todo_write: tolak lebih dari 1 in_progress", async () => {
  await withTempCwd(async () => {
    const res = await todoWriteTool.func(
      {
        todos: [
          { content: "A", activeForm: "Mengerjakan A", status: "in_progress" },
          { content: "B", activeForm: "Mengerjakan B", status: "in_progress" },
        ],
      },
      { configurable: { sessionId: "sess-2" } }
    );
    assert.ok(res.includes("❌"));
    assert.ok(res.includes("Maksimal 1"));
  });
});

test("todo_write: tolak status tidak valid", async () => {
  await withTempCwd(async () => {
    const res = await todoWriteTool.func(
      { todos: [{ content: "A", activeForm: "Mengerjakan A", status: "done" }] },
      { configurable: { sessionId: "sess-3" } }
    );
    assert.ok(res.includes("❌"));
    assert.ok(res.includes("Status tidak valid"));
  });
});

test("todo_write: getTodos untuk sesi kosong mengembalikan array kosong", async () => {
  await withTempCwd(async () => {
    const stored = await getTodos("belum-pernah-ada");
    assert.deepEqual(stored, []);
  });
});
