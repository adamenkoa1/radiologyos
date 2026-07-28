import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("patients export is staff-gated and emits a Google Contacts CSV", async () => {
  const route = await read("app/api/staff/patients/export/route.ts");
  assert.match(route, /requireStaff\(/);
  assert.match(route, /text\/csv/);
  assert.match(route, /Phone 1 - Value/);
  assert.match(route, /content-disposition/);
  assert.match(route, /do_not_contact/); // opted-out patients are excluded
});

test("patients page links to the CSV export", async () => {
  const page = await read("app/staff/patients/page.tsx");
  assert.match(page, /\/api\/staff\/patients\/export/);
  assert.match(page, /Google Контакти/);
});
