// Відмітка прибуття/неявки з Пульта: PATCH {id, status} через state machine.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withD1, jsonRequest, callWorker, seedStaffSession } from "./helpers/d1.mjs";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

async function seed(db, { id = 1, status = "confirmed" }) {
  await db.prepare(
    `INSERT INTO bookings (id, code, name, phone, phone_normalized, service, service_code,
       equipment_id, duration_minutes, desired_date, desired_time, status, date_of_birth, patient_category, organization_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`
  ).bind(id, `RD-260810-${String(id).padStart(3, "0")}`, "Пацієнт", "+380971112233", "380971112233",
    "Рентген", "201", "xray", 15, "2026-09-01", "10:00", status, "1990-05-05", "civilian").run();
}
const patch = (db, cookie, body) =>
  callWorker(jsonRequest("/api/staff/bookings", body, { method: "PATCH", headers: { cookie } }), db);

test("a confirmed booking can be marked arrived", async () => {
  await withD1(async (db) => {
    await seed(db, { id: 1, status: "confirmed" });
    const cookie = await seedStaffSession(db, { email: "reg@likarnya.test", role: "registrar" });
    const res = await patch(db, cookie, { id: 1, status: "arrived" });
    assert.equal(res.status, 200);
    assert.equal(await db.prepare("SELECT status FROM bookings WHERE id = 1").first("status"), "arrived");
  });
});

test("a confirmed booking can be marked no_show", async () => {
  await withD1(async (db) => {
    await seed(db, { id: 2, status: "confirmed" });
    const cookie = await seedStaffSession(db, { email: "reg@likarnya.test", role: "registrar" });
    const res = await patch(db, cookie, { id: 2, status: "no_show" });
    assert.equal(res.status, 200);
    assert.equal(await db.prepare("SELECT status FROM bookings WHERE id = 2").first("status"), "no_show");
    const ev = await db.prepare("SELECT COUNT(*) AS n FROM booking_events WHERE booking_id = 2 AND details = 'no_show'").first("n");
    assert.equal(ev, 1);
  });
});

test("an impossible transition is rejected by the state machine", async () => {
  await withD1(async (db) => {
    await seed(db, { id: 3, status: "issued" });
    const cookie = await seedStaffSession(db, { email: "reg@likarnya.test", role: "registrar" });
    const res = await patch(db, cookie, { id: 3, status: "arrived" });
    assert.equal(res.status, 409); // issued → arrived недопустимо
  });
});

test("dashboard wires overdue marking and arrived/no-show quick actions", async () => {
  const page = await read("app/staff/dashboard/page.tsx");
  assert.match(page, /async function setStatus\(id:number, status:string/);
  assert.match(page, /const isOverdue = \(b:CalBooking\)/);
  assert.match(page, /setStatus\(b\.id, "arrived"/);
  assert.match(page, /setStatus\(b\.id, "no_show"/);
  assert.match(page, /isOverdue\(b\) \? " overdue" : ""/);
  const css = await read("app/styles/02-workspace.css");
  assert.match(css, /\.dashAgendaRow\.overdue\{/);
  assert.match(css, /\.dashMark\{/);
});
