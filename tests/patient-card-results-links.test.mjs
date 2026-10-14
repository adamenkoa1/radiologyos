// Лікар у картці пацієнта (/staff/patients) має з кожного виконаного візиту
// відкрити і протокол (висновок), і знімки — обидва через deep-link ?open=<id>,
// не шукаючи дослідження вручну в /staff/protocols чи /staff/imaging.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("patient card visit links to both the protocol and the images", async () => {
  const page = await read("app/staff/patients/page.tsx");
  // PR-D: посилання на протокол тепер через ?studyId= і доступне для будь-якого
  // не-скасованого візиту (лейбл Створити/Відкрити залежно від наявності).
  assert.match(page, /href=\{`\/staff\/protocols\?studyId=\$\{booking\.id\}`\}/);
  assert.match(page, /href=\{`\/staff\/imaging\?open=\$\{booking\.id\}`\}>Знімки →/);
});

test("the imaging page honours the ?open= deep link", async () => {
  const imaging = await read("app/staff/imaging/page.tsx");
  assert.match(imaging, /new URLSearchParams\(window\.location\.search\)\.get\("open"\)/);
});
