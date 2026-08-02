import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("staff can create a booking via POST, guarded and conflict-checked", async () => {
  const route = await read("app/api/staff/bookings/route.ts");
  assert.match(route, /export async function POST/);
  assert.match(route, /canManageBookings\(member\.role\)/);
  assert.match(route, /normalizeUkrainianPhone\(/);
  assert.match(route, /isBookableDate\(desiredDate\) \|\| !isDayOpen\(desiredDate, schedule\) \|\| !validTimes\.includes/);
  assert.match(route, /Цей час уже зайнятий/); // перевірка конфлікту слота
  assert.match(route, /INSERT INTO bookings/);
  assert.match(route, /'confirmed',CURRENT_TIMESTAMP/); // персональний запис одразу підтверджений
  assert.match(route, /assigned_radiologist_email, assigned_radiographer_email/);
  assert.match(route, /booking_events .* 'created_by_staff'/s);
});

test("new-booking form gathers patient, service, slot and staff, and posts", async () => {
  const page = await read("app/staff/book/page.tsx");
  assert.match(page, /title="Записати пацієнта"/);
  assert.match(page, /від імені пацієнта/);
  assert.match(page, /\/api\/availability\?date=/); // вільні слоти
  assert.match(page, /method: "POST"[\s\S]*\/api\/staff\/bookings|\/api\/staff\/bookings[\s\S]*method: "POST"/);
  assert.match(page, /name="name"/);
  assert.match(page, /name="phone"/);
  assert.match(page, /assignedRadiologistEmail/);
  assert.match(page, /groupedServices\(\)/);
});

test("new-booking is reachable from nav and the calendar", async () => {
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /href:"\/staff\/book"/);
  const cal = await read("app/staff/week-calendar.tsx");
  assert.match(cal, /apptNewBtn/);
  assert.match(cal, /\/staff\/book/);
});
