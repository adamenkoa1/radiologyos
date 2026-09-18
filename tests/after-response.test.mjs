// runAfterResponse: відкладає best-effort ефект через ctx.waitUntil, а без
// контексту — не кидає й поглинає відмову (щоб заявка не залежала від розсилки).

import assert from "node:assert/strict";
import test from "node:test";
import { runAfterResponse } from "../lib/after-response.ts";

test("використовує ctx.waitUntil, коли контекст доступний", async () => {
  const seen = [];
  globalThis.__RADIOLOGY_CTX__ = { waitUntil: (p) => seen.push(p) };
  try {
    let ran = false;
    runAfterResponse(Promise.resolve().then(() => { ran = true; }));
    assert.equal(seen.length, 1, "проміс має піти у waitUntil");
    await seen[0];
    assert.equal(ran, true);
  } finally {
    delete globalThis.__RADIOLOGY_CTX__;
  }
});

test("відмову, передану у waitUntil, поглинуто (не reject)", async () => {
  let captured;
  globalThis.__RADIOLOGY_CTX__ = { waitUntil: (p) => { captured = p; } };
  try {
    runAfterResponse(Promise.reject(new Error("boom")));
    await captured; // має вирішитися, а не впасти
  } finally {
    delete globalThis.__RADIOLOGY_CTX__;
  }
});

test("без контексту не кидає і не лишає unhandled-rejection", async () => {
  delete globalThis.__RADIOLOGY_CTX__;
  assert.doesNotThrow(() => runAfterResponse(Promise.reject(new Error("boom"))));
  await new Promise((r) => setTimeout(r, 10));
});
