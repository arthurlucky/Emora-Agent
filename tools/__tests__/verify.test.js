/**
 * Test tools/verify.js — fixture project mini.
 * Kontrak: plain-text report (bukan JSON) agar render rapi di TUI/gateway/webui.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import { verifyTool, detectFramework } from "../verify.js";

const TMP = path.join(process.cwd(), "tools/__tests__/tmp-verify");

async function makeProject(scripts) {
  await fs.mkdir(TMP, { recursive: true });
  await fs.writeFile(path.join(TMP, "package.json"), JSON.stringify({
    name: "fixture", scripts,
  }));
}

test("detectFramework: npm terdeteksi", async () => {
  await makeProject({ test: "node -e \"process.exit(0)\"" });
  const fw = detectFramework(TMP);
  assert.ok(fw);
  assert.equal(fw.framework, "npm test");
});

test("verify: passing test", async () => {
  await makeProject({ test: "node -e \"process.exit(0)\"" });
  const r = await verifyTool.invoke({ path: TMP });
  assert.ok(r.includes("PASSED"), `expected PASSED, got: ${r.slice(0, 300)}`);
});

test("verify: failing test", async () => {
  await makeProject({ test: "node -e \"process.exit(1)\"" });
  const r = await verifyTool.invoke({ path: TMP });
  assert.ok(r.includes("FAILED"), `expected FAILED, got: ${r.slice(0, 300)}`);
});

test("verify: no framework → skipped", async () => {
  const empty = path.join(TMP, "..", "tmp-verify-empty");
  await fs.mkdir(empty, { recursive: true });
  await fs.rm(path.join(empty, "package.json"), { force: true });
  await fs.rm(path.join(empty, "Makefile"), { force: true });
  await fs.rm(path.join(empty, "Cargo.toml"), { force: true });
  await fs.rm(path.join(empty, "go.mod"), { force: true });
  const r = await verifyTool.invoke({ path: empty, files_to_audit: [] });
  assert.ok(r.includes("Skipped") || r.includes("Tidak ada"), `got: ${r.slice(0, 300)}`);
});

test("verify: missing path", async () => {
  const out = await verifyTool.invoke({ path: "/nonexistent-xyz-123" });
  assert.ok(out.includes("tidak ditemukan"));
});

test("cleanup", async () => {
  await fs.rm(path.join(process.cwd(), "tools/__tests__/tmp-verify"), { recursive: true, force: true });
  await fs.rm(path.join(process.cwd(), "tools/__tests__/tmp-verify-empty"), { recursive: true, force: true });
});
