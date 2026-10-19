/**
 * Test untuk tools/search_text.js — pakai node:test (built-in, no dep).
 * Fixture dibuat di /tmp saat test jalan supaya tidak tergantung isi repo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import searchTextTool from "../search_text.js";

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "search-text-test-"));
  fs.mkdirSync(path.join(dir, "sub"));
  fs.mkdirSync(path.join(dir, "node_modules"));
  fs.writeFileSync(
    path.join(dir, "a.js"),
    'function hello() {\n  console.log("Hello World");\n}\nfunction goodbye() {\n  console.log("Hello World");\n}\n'
  );
  fs.writeFileSync(path.join(dir, "sub", "b.py"), 'def hello():\n    print("hello world")\n');
  fs.writeFileSync(path.join(dir, "node_modules", "ignored.js"), "Hello World should be ignored");
  return dir;
}

test("search_text: substring match, case-insensitive default", async () => {
  const dir = makeFixture();
  const raw = await searchTextTool.func({ query: "hello world", path: dir });
  const parsed = JSON.parse(raw);
  assert.ok(parsed.matches >= 3, `expected >=3 matches, got ${parsed.matches}`);
  const files = parsed.results.map((r) => r.file);
  assert.ok(!files.some((f) => f.includes("node_modules")), "node_modules harus diabaikan");
});

test("search_text: case_sensitive:true tidak match beda huruf", async () => {
  const dir = makeFixture();
  const raw = await searchTextTool.func({ query: "HELLO WORLD", path: dir, case_sensitive: true });
  const parsed = JSON.parse(raw);
  assert.equal(parsed.matches, 0);
});

test("search_text: regex:true mendukung pola regex", async () => {
  const dir = makeFixture();
  const raw = await searchTextTool.func({ query: "function \\w+\\(\\)", path: dir, regex: true });
  const parsed = JSON.parse(raw);
  assert.ok(parsed.matches >= 2);
});

test("search_text: glob membatasi ke jenis file tertentu", async () => {
  const dir = makeFixture();
  const raw = await searchTextTool.func({ query: "hello", path: dir, glob: "**/*.py" });
  const parsed = JSON.parse(raw);
  assert.ok(parsed.results.every((r) => r.file.endsWith(".py")));
  assert.ok(parsed.matches >= 1);
});

test("search_text: context_lines menyertakan baris sekitar", async () => {
  const dir = makeFixture();
  const raw = await searchTextTool.func({ query: "console.log", path: dir, context_lines: 1 });
  const parsed = JSON.parse(raw);
  assert.ok(parsed.results.length >= 1);
  const first = parsed.results[0];
  assert.ok(Array.isArray(first.context.before));
  assert.ok(Array.isArray(first.context.after));
});
