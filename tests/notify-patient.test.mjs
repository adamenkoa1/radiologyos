import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("ad-hoc patient message: lib + endpoint + drawer UI", async () => {
  const lib = await read("lib/notify.ts");
  assert.match(lib, /export async function sendPatientMessage/);
  assert.match(lib, /Пацієнт у списку «не турбувати»/); // поважає DNC
  assert.doesNotMatch(lib, /sendPatientMessage[\s\S]*patient_reminders_enabled/); // не залежить від тумблера автонагадувань

  const route = await read("app/api/staff/notify/route.ts");
  assert.match(route, /canWriteNotes\(ctx\.member\.role/); // доступ усім активним ролям (зокрема рентгенологу)
  assert.match(route, /organization_id = \?/); // tenant-scoped
  assert.match(route, /sendPatientMessage\(/);
  assert.match(route, /'notified'/); // подія в журналі заявки

  const drawer = await read("app/staff/booking-drawer.tsx");
  assert.match(drawer, /\/api\/staff\/notify/);
  assert.match(drawer, /✉ Повідомити/);
  assert.match(drawer, /NOTIFY_PRESETS/);
});
