import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("booking drawer does not infer exact history or direct contact actions from phone", async () => {
  const drawer = await read("app/staff/booking-drawer.tsx");

  assert.match(drawer, /const history = historyScoped\s*\?\s*all\.filter\(x => x\.id !== b\.id\)/s);
  assert.doesNotMatch(drawer, /historyScoped[^;]*digits\(x\.phone\)/s);
  assert.doesNotMatch(drawer, /https:\/\/wa\.me\//);
  assert.doesNotMatch(drawer, /href=\{`tel:/);
  assert.match(drawer, /fetch\("\/api\/staff\/notify"/);
});
