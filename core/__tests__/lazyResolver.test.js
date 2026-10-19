import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLazyToolNames, filterToolsByNames, shouldBypass } from "../lib/lazyResolver.js";
import { essentialTools } from "../toolManifest.js";

const fake = (name) => ({ name });

test("bypass untuk konteks besar", () => {
  assert.equal(shouldBypass(100_000), true);
  assert.equal(shouldBypass(8_000), false);
  const r = resolveLazyToolNames("baca file ini", { contextTokens: 1_000_000 });
  assert.equal(r.mode, "bypass-large-context");
  assert.equal(r.names, null);
});

test("smalltalk → tanpa tool", () => {
  const r = resolveLazyToolNames("halo", {});
  assert.deepEqual(r.names, []);
});

test("web match + essential ikut", () => {
  const r = resolveLazyToolNames("cari berita crypto terbaru", {});
  assert.equal(r.mode, "filtered");
  assert.ok(r.names.includes("search_web"));
  for (const e of essentialTools()) assert.ok(r.names.includes(e), `essential ${e} hilang`);
});

test("nama legacy dinormalisasi (scheduler_tool → scheduler)", () => {
  const tools = [fake("scheduler"), fake("bash")];
  const out = filterToolsByNames(tools, ["scheduler_tool", "bash"]);
  assert.ok(out.some((t) => t.name === "scheduler"));
});

test("no-match → full (fail-open)", () => {
  const r = resolveLazyToolNames("xyz qwerty blabla tanpa keyword", {});
  assert.equal(r.mode, "full");
  assert.equal(r.names, null);
});
