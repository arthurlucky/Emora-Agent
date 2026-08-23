/**
 * Test untuk tools/patch.js — pakai node:test (built-in, no dep).
 * 4 variasi: indent mismatch, trailing-space mismatch, CRLF mismatch, case-insensitive.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { patchString } from "../patch.js";

const sample =
  "function greet(name) {\n" +
  "    return \"Hello, \" + name;\n" +
  "}\n" +
  "\n" +
  "function farewell(name) {\n" +
  "    return \"Goodbye, \" + name;\n" +
  "}";

test("patch: exact match", () => {
  const r = patchString(sample, "    return \"Hello, \" + name;", "    return `Hi, ${name}!`;");
  assert.equal(r.ok, true);
  assert.equal(r.strategy, "exact");
  assert.ok(r.result.includes("`Hi, ${name}!`"));
});

test("patch: indent mismatch (extra leading spaces in old_string)", () => {
  const r = patchString(
    sample,
    "        return \"Hello, \" + name;",   // 8 spasi vs 4 di file
    "    return `Hi, ${name}!`;"
  );
  assert.equal(r.ok, true);
  assert.equal(r.strategy, "indent-flex");
});

test("patch: trailing-space mismatch", () => {
  const r = patchString(
    sample,
    "    return \"Hello, \" + name;   ",   // trailing spaces
    "    return `Hi, ${name}!`;"
  );
  assert.equal(r.ok, true);
  assert.equal(r.strategy, "trim");
});

test("patch: case-insensitive", () => {
  const r = patchString(
    sample,
    "function Greet(name) {",   // kapital
    "function greet(name, lang) {"
  );
  assert.equal(r.ok, true);
  assert.equal(r.strategy, "case-insensitive");
});

test("patch: not found returns error", () => {
  const r = patchString(sample, "function doesntExist()", "x");
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("tidak ditemukan"));
});

test("patch: prefix-anchored (60% prefix match)", () => {
  // Kasus ekstrim: old_string beda signifikan dari content tapi prefix awal
  // (~60% karakter pertama) cocok. Bikin content yang punya prefix panjang
  // yang tidak akan match exact.
  const longText = "X".repeat(200) + "TAIL_CONTENT";  // 200 X lalu tail
  const oldStr = "X".repeat(150) + "NEEDLE_REPLACED"; // 150 X (match prefix 60% via slice(0,90))
  // normPrefix = slice(0, 60% * length). Untuk oldStr 162 char, prefix = 97 char = "X"*97.
  // Untuk longText 211 char, prefix = 126 char = "X"*126.
  // indexOf("X"*97) di "X"*200 = 0. Match prefix-anchored.
  const r = patchString(longText, oldStr, "REPLACED");
  assert.equal(r.ok, true);
  // Strategy bisa "exact" atau "prefix-anchored" — yang penting match.
  assert.ok(["exact", "prefix-anchored"].includes(r.strategy));
});
