/**
 * Test core/linkBudget.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { enforceLinkBudget } from "../linkBudget.js";

test("budget: under limit → untouched", () => {
  const msgs = [{ role: "user", content: "halo" }, { role: "assistant", content: "hai" }];
  const r = enforceLinkBudget(msgs, 200_000);
  assert.equal(r.trimmed, false);
  assert.equal(r.messages.length, 2);
});

test("budget: over limit → oldest history dropped first", () => {
  // 3 pesan besar; system di index 0 harus selamat.
  const big = "x".repeat(80_000);
  const msgs = [
    { role: "system", content: "system prompt" },
    { role: "user", content: big },
    { role: "assistant", content: big },
    { role: "user", content: "pertanyaan terbaru" },
  ];
  const r = enforceLinkBudget(msgs, 150_000); // total ~240K > 90% budget
  assert.equal(r.trimmed, true);
  assert.ok(r.dropped >= 1);
  assert.equal(r.messages[0].role, "system"); // system selalu pertama & selamat
  assert.equal(r.messages[r.messages.length - 1].content, "pertanyaan terbaru"); // pesan terakhir selamat
});

test("budget: extreme over → hard cap keeps system + last message", () => {
  const huge = "y".repeat(300_000);
  const msgs = [
    { role: "system", content: "sys" },
    { role: "user", content: huge },
    { role: "user", content: "last" },
  ];
  const r = enforceLinkBudget(msgs, 200_000);
  assert.equal(r.trimmed, true);
  assert.equal(r.messages[0].role, "system");
  assert.equal(r.messages[r.messages.length - 1].content, "last");
});
