/**
 * Test tools/verify.js — fixture project mini.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import { verifyTool } from "../verify.js";

const TMP = path.join(process.cwd(), "tools/__tests__/tmp-verify");

async function makeProject(scripts) {
  await fs.mkdir(TMP, { recursive: true });
  await fs.writeFile(path.join(TMP, "package.json"), JSON.stringify({
    name: "fixture", scripts,
  }));
}

test("verify: passing test", async () => {
  await makeProject({ test: "node --eval 'console.log(1)'" });
  const r = JSON.parse(await verifyTool.invoke({ path: TMP }));
  assert.equal(r.ok, true);
  assert.equal(r.framework, "npm test");
});

test("verify: failing test", async () => {
  await makeProject({ test: "node --eval 'process.exit(1)'" });
  const r = JSON.parse(await verifyTool.invoke({ path: TMP }));
  assert.equal(r.ok, false);
});

test("verify: no framework → skipped", async () => {
  const empty = path.join(TMP, "..", "tmp-verify-empty");
  await fs.mkdir(empty, { recursive: true });
  const r = JSON.parse(await verifyTool.invoke({ path: empty }));
  assert.equal(r.ok, true);
  assert.ok(r.skipped);
});

test("verify: missing path", async () => {
  const out = await verifyTool.invoke({ path: "/nonexistent-xyz-123" });
  assert.ok(out.includes("tidak ditemukan"));
});

test("cleanup", async () => {
  await fs.rm(path.join(process.cwd(), "tools/__tests__/tmp-verify"), { recursive: true, force: true });
  await fs.rm(path.join(process.cwd(), "tools/__tests__/tmp-verify-empty"), { recursive: true, force: true });
});
