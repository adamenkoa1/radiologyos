// Робочі дії /staff/protocols замість пісочниці (PR-B): walk-in форма
// «Нове дослідження», посилання на розклад/пацієнтів, deep-link ?studyId.
// Перевірка через інспекцію джерела (sandbox прибрано).

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("sandbox is fully removed from the protocols page and styles", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.doesNotMatch(page, /sandbox|Пісочниц|Спробувати конструктор/i);
  const css = await read("app/styles/02-workspace.css");
  assert.doesNotMatch(css, /protocolSandbox/);
});

test("real action buttons replace the sandbox button (new study + scheduled + patients)", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /canCreateStudy && <div className="protocolQueueActions">/);
  assert.match(page, /\+ Нове дослідження/);
  assert.match(page, /href="\/staff\/book"/);
  assert.match(page, /href="\/staff\/patients"/);
});

test("walk-in create calls the dedicated endpoint and opens the new study", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  const fn = page.slice(page.indexOf("async function createWalkInStudy"), page.indexOf("async function openBooking"));
  assert.match(fn, /fetch\("\/api\/staff\/protocols\/studies"/);
  assert.match(fn, /method: "POST"/);
  assert.match(fn, /openBooking\(data\.bookingId\)/);
  assert.match(fn, /loadQueue\(\)/);
});

test("study creation is gated to admin/registrar (canCreateStudy)", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /const canCreateStudy = staff\?\.role === "admin" \|\| staff\?\.role === "registrar";/);
});

test("deep link ?studyId opens the study (plus legacy ?open)", async () => {
  const page = await read("app/staff/protocols/page.tsx");
  assert.match(page, /params\.get\("studyId"\) \|\| params\.get\("open"\)/);
});

test("endpoint exists and is role-guarded + audited", async () => {
  const route = await read("app/api/staff/protocols/studies/route.ts");
  assert.match(route, /canManageBookings\(member\.role\)/);
  assert.match(route, /INSERT INTO bookings/);
  assert.match(route, /performed_at/);
  assert.match(route, /booking_walkin_created/);
  const labels = await read("lib/audit.ts");
  assert.match(labels, /booking_walkin_created:/);
});
