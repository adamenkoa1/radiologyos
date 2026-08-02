import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("room schedule shows services linked to the selected equipment", async () => {
  const page = await read("app/staff/schedule/page.tsx");
  assert.match(page, /SERVICES\.filter\(service => service\.equipmentId === activeEquipment\)/);
  assert.match(page, /Послуги цього кабінету/);
  assert.match(page, /\/staff\/tariffs/);
  assert.match(page, /service\.durationMinutes/);
});

test("catalog links CT, digital X-ray and fluorography services to rooms", async () => {
  const catalog = await read("lib/catalog.ts");
  for (const equipmentId of ["ct", "xray", "fluoro"]) {
    assert.match(catalog, new RegExp(`equipmentId:\"${equipmentId}\"`));
  }
});
