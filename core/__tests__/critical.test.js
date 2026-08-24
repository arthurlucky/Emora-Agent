/**
 * Test jalur kritis: modelProfiles + change_mode (plan gate) + linkBudget edge.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

test("modelProfiles: save/use/rm cycle", async () => {
  process.env.MODEL_PROVIDER = "openrouter";
  process.env.MODEL_NAME = "test-model";
  const mp = await import("../modelProfiles.js");

  await mp.saveProfile("_test_prof");
  let list = await mp.listProfiles();
  assert.ok(list._test_prof, "profile tersimpan");

  // ganti env ke nilai lain, lalu use → harus balik
  process.env.MODEL_NAME = "lain";
  await mp.useProfile("_test_prof");
  assert.equal(process.env.MODEL_NAME, "test-model");

  await mp.removeProfile("_test_prof");
  list = await mp.listProfiles();
  assert.ok(!list._test_prof, "profile terhapus");
});

test("change_mode: plan mode default-deny", async () => {
  const cm = await import("../../tools/change_mode.js");
  await cm.setMode("plan");
  assert.equal(await cm.isToolAllowed("read_file", "plan"), true);
  assert.equal(await cm.isToolAllowed("shell_exec", "plan"), false);
  assert.equal(await cm.isToolAllowed("mcp_unknown_tool", "plan"), false); // default-deny
  assert.equal(await cm.isToolAllowed("apa_saja", "autonomous"), true);
  await cm.setMode("autonomous"); // restore
});

test("linkBudget edge: empty & single message", async () => {
  const { enforceLinkBudget } = await import("../linkBudget.js");
  const r1 = enforceLinkBudget([], 1000);
  assert.equal(r1.trimmed, false);
  const r2 = enforceLinkBudget([{ role: "user", content: "x" }], 10);
  assert.equal(r2.messages.length >= 1, true); // minimal system/last selamat
});
