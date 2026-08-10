// Код заявки показується однаково — моноширинним чипом .codeTag — на
// щоденних staff-екранах (черга, Пульт, drawer, Прийом).

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { globalsCss } from "./helpers/css.mjs";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("code is rendered via the shared .codeTag chip on daily staff surfaces", async () => {
  for (const p of [
    "app/staff/page.tsx",
    "app/staff/dashboard/page.tsx",
    "app/staff/booking-drawer.tsx",
    "app/staff/intake/page.tsx",
  ]) {
    const src = await read(p);
    assert.match(src, /className="codeTag">\{[a-zA-Z.]*\.code\}/, `${p} має показувати код через .codeTag`);
  }
  const css = await globalsCss();
  assert.match(css, /\.codeTag\{[^}]*monospace/);
});
