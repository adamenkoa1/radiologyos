// Крос-модульні дії «Створити/відкрити протокол» → /staff/protocols?studyId=
// з картки пацієнта та дошки досліджень (PR-D). Інспекція джерела.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("patient card links any non-cancelled visit to its protocol via ?studyId", async () => {
  const page = await read("app/staff/patients/page.tsx");
  assert.match(page, /booking\.status !== "cancelled" && <div className="crmVisitLinks">/);
  assert.match(page, /\/staff\/protocols\?studyId=\$\{booking\.id\}/);
  // Лейбл залежить від наявності протоколу.
  assert.match(page, /\? "Відкрити протокол →" : "Створити протокол →"/);
  // Старий performed-гейт для посилання на протокол прибрано.
  assert.doesNotMatch(page, /protocols\?open=\$\{booking\.id\}/);
});

test("studies board links each study to its protocol via ?studyId", async () => {
  const page = await read("app/staff/studies/page.tsx");
  assert.match(page, /\/staff\/protocols\?studyId=\$\{s\.id\}/);
  assert.match(page, /Протокол →/);
});

test("protocols page receives ?studyId (deep-link) to open the study", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /params\.get\("studyId"\)/);
});
