/**
 * Test untuk tools/patch.js — pakai node:test (built-in, no dep).
 *
 * Cakupan:
 *  - 5 tingkat pencocokan per-baris (exact -> trim-trailing ->
 *    whitespace-normalized -> ignore-comments -> case-insensitive)
 *  - uniqueness check (ambiguous match ditolak, replace_all mengganti semua)
 *  - diff preview ikut dikembalikan saat sukses
 *  - fallback prefix-anchored HANYA aktif dengan allow_risky_match:true
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
  assert.ok(r.diff.includes("@@"));
});

test("patch: indent mismatch -> whitespace-normalized tier", () => {
  const r = patchString(
    sample,
    "        return \"Hello, \" + name;",   // 8 spasi vs 4 di file
    "    return `Hi, ${name}!`;"
  );
  assert.equal(r.ok, true);
  assert.equal(r.strategy, "whitespace-normalized");
});

test("patch: trailing-space mismatch -> trim-trailing tier", () => {
  const r = patchString(
    sample,
    "    return \"Hello, \" + name;   ",   // trailing spaces, leading tetap sama
    "    return `Hi, ${name}!`;"
  );
  assert.equal(r.ok, true);
  assert.equal(r.strategy, "trim-trailing");
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

test("patch: not found returns error (tanpa allow_risky_match)", () => {
  const r = patchString(sample, "function doesntExist()", "x");
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("tidak ditemukan"));
});

test("patch: prefix-anchored HANYA jalan dengan allow_risky_match:true", () => {
  const longText = "X".repeat(200) + "TAIL_CONTENT";
  const oldStr = "X".repeat(150) + "NEEDLE_REPLACED";

  const denied = patchString(longText, oldStr, "REPLACED");
  assert.equal(denied.ok, false, "tanpa allow_risky_match, fallback berisiko tidak boleh jalan otomatis");

  const allowed = patchString(longText, oldStr, "REPLACED", { allow_risky_match: true });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.strategy, "prefix-anchored");
  assert.equal(allowed.risky, true);
});

test("patch: ambiguous match (>1 kecocokan) ditolak by default", () => {
  const content = "const x = 1;\nconst y = 1;\nconst z = 2;";
  const r = patchString(content, "const x = 1;\nconst y = 1;", "const x = 9;\nconst y = 9;");
  // old_string di contoh ini unik (2 baris berurutan), jadi harus sukses dulu untuk memvalidasi setup:
  assert.equal(r.ok, true);

  // Sekarang kasus yang BENAR-BENAR ambigu: pola satu baris muncul 2x.
  const dup = "if (ok) {\n  return 1;\n}\nif (ok) {\n  return 1;\n}\n";
  const ambiguous = patchString(dup, "  return 1;", "  return 2;");
  assert.equal(ambiguous.ok, false);
  assert.ok(ambiguous.error.includes("AMBIGU"));
  assert.ok(ambiguous.error.includes("baris 2"));
  assert.ok(ambiguous.error.includes("baris 5"));
});

test("patch: replace_all mengganti semua kecocokan sekaligus", () => {
  const dup = "if (ok) {\n  return 1;\n}\nif (ok) {\n  return 1;\n}\n";
  const r = patchString(dup, "  return 1;", "  return 2;", { replace_all: true });
  assert.equal(r.ok, true);
  assert.equal(r.replacements, 2);
  const occurrences = (r.result.match(/return 2;/g) || []).length;
  assert.equal(occurrences, 2);
});
