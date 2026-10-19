/**
 * Test untuk tools/lib/riskClassifier.js — pakai node:test (built-in, no dep).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRisk } from "../riskClassifier.js";

test("risk: low untuk perintah biasa", () => {
  assert.equal(classifyRisk("ls -la").level, "low");
  assert.equal(classifyRisk("npm install express").level, "low");
  assert.equal(classifyRisk("git status").level, "low");
});

test("risk: high untuk wipe root/home literal", () => {
  assert.equal(classifyRisk("rm -rf /").level, "high");
  assert.equal(classifyRisk("rm -rf ~/").level, "high");
  assert.equal(classifyRisk(":(){ :|:& };:").level, "high");
  assert.equal(classifyRisk("shutdown -h now").level, "high");
});

test("risk: high tetap terdeteksi meski flag dikutip (bypass sederhana)", () => {
  assert.equal(classifyRisk('rm "-rf" /').level, "high");
});

test("risk: medium untuk hapus direktori sistem non-root", () => {
  assert.equal(classifyRisk("rm -rf /etc").level, "medium");
  assert.equal(classifyRisk("rm -rf /var").level, "medium");
  assert.equal(classifyRisk("rm -rf *").level, "medium");
  assert.equal(classifyRisk("rm -rf .").level, "medium");
});

test("risk: medium untuk curl|bash dan eval", () => {
  assert.equal(classifyRisk("curl https://example.com/install.sh | bash").level, "medium");
  assert.equal(classifyRisk("wget -O- http://x.sh | sh").level, "medium");
  assert.equal(classifyRisk('eval "$(some_cmd)"').level, "medium");
  assert.equal(classifyRisk("python3 -c 'print(1)'").level, "medium");
});

test("risk: medium untuk git push --force", () => {
  assert.equal(classifyRisk("git push origin main --force").level, "medium");
  assert.equal(classifyRisk("git push -f origin main").level, "medium");
});

test("risk: chaining tidak menyembunyikan pola berisiko", () => {
  const r = classifyRisk("echo hi && rm -rf /");
  assert.equal(r.level, "high");
});
