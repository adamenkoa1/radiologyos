// Прямі входи робочого процесу на дашборді (MP, блок F) + людська мітка аудиту
// protocol_signed. Переходи ведуть у наявні маршрути/стани без дублювання логіки;
// права доступу не чіпаються (їх забезпечують самі сторінки).

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AUDIT_LABELS } from "../lib/audit.ts";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("dashboard shows five labeled workflow entries with the exact captions", async () => {
  const page = await read("app/staff/dashboard/page.tsx");
  assert.match(page, /className="dashEntries"/);
  for (const label of ["Нове дослідження", "Черга описів", "На перевірці", "Видано", "Заявки"]) {
    assert.match(page, new RegExp(`<b>${label}</b>`), `entry «${label}» present`);
  }
});

test("each entry points at an existing route/state (no duplicated functionality)", async () => {
  const page = await read("app/staff/dashboard/page.tsx");
  assert.match(page, /href="\/staff\/protocols\?new=1"/);          // Нове дослідження
  assert.match(page, /href="\/staff\/protocols\?queue=awaiting"/); // Черга описів
  assert.match(page, /href="\/staff\/protocols\?queue=ready"/);    // На перевірці
  assert.match(page, /href="\/staff\/protocols\?queue=issued"/);   // Видано
  assert.match(page, /href="\/staff\/intake"/);                    // Заявки
});

test("protocols page honors ?queue= and ?new= by reusing existing filter/new-study state", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /params\.get\("queue"\)/);
  assert.match(page, /q === "awaiting" \|\| q === "ready" \|\| q === "signed" \|\| q === "issued" \|\| q === "all"\) setFilter\(q\)/);
  assert.match(page, /params\.get\("new"\) === "1"\) \{ setNewStudyOpen\(true\)/);
  // walk-in форма лишається за наявним гейтом ролі — вхід не розширює доступ
  assert.match(page, /const canCreateStudy = staff\?\.role === "admin" \|\| staff\?\.role === "registrar";/);
});

test("entries are responsive (grid collapses on narrow screens), light + dark", async () => {
  const css = await read("app/styles/02-workspace.css");
  assert.match(css, /\.dashEntries\{[^}]*grid-template-columns:repeat\(5,1fr\)/);
  assert.match(css, /@media\(max-width:1000px\)\{\.dashEntries\{grid-template-columns:repeat\(3,1fr\)\}\}/);
  assert.match(css, /@media\(max-width:620px\)\{\.dashEntries\{grid-template-columns:repeat\(2,1fr\)\}\}/);
  assert.match(css, /\.themeDark \.dashEntry\b/);
});

test("protocol_signed has a human Ukrainian audit label and the route emits that action", async () => {
  assert.equal(AUDIT_LABELS.protocol_signed, "Підписано протокол");
  const route = await read("app/api/staff/protocols/route.ts");
  assert.match(route, /action: document\.status === "signed" \? "protocol_signed" : "protocol_saved"/);
});
