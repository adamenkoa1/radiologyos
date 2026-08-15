// Command palette (⌘K): global search against the live schema + workspace mount.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withD1, jsonRequest, callWorker, seedStaffSession } from "./helpers/d1.mjs";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

async function seed(db, { id, code, name, phone, phoneNorm, org = 1, time = "10:00" }) {
  await db.prepare(
    `INSERT INTO bookings (id, code, name, phone, phone_normalized, service, service_code,
       desired_date, desired_time, status, date_of_birth, patient_category, organization_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, code, name, phone, phoneNorm, "КТ", "CT-01", "2026-09-01", time, "new", "1990-05-05", "civilian", org).run();
}

const search = (db, cookie, q) =>
  callWorker(jsonRequest(`/api/staff/search?q=${encodeURIComponent(q)}`, undefined, { method: "GET", headers: { cookie } }), db);

const bookingsOnly = (data) => data.results.filter((r) => r.type === "booking");

test("search is staff-only", async () => {
  await withD1(async (db) => {
    const res = await callWorker(jsonRequest("/api/staff/search?q=іван", undefined, { method: "GET" }), db);
    assert.equal(res.status, 403);
  });
});

test("search matches booking by name, phone and RD code", async () => {
  await withD1(async (db) => {
    await seed(db, { id: 1, code: "RD-AAAA1111", name: "Іваненко Іван", phone: "+380971112233", phoneNorm: "380971112233", time: "10:00" });
    await seed(db, { id: 2, code: "RD-BBBB2222", name: "Петренко Петро", phone: "+380975556677", phoneNorm: "380975556677", time: "10:30" });
    const cookie = await seedStaffSession(db, { email: "reg@likarnya.test", role: "registrar" });

    const byName = await (await search(db, cookie, "іваненко")).json();
    assert.equal(bookingsOnly(byName).length, 1);
    assert.equal(bookingsOnly(byName)[0].code, "RD-AAAA1111");

    const byCode = await (await search(db, cookie, "bbbb2222")).json();
    assert.equal(bookingsOnly(byCode).length, 1);
    assert.equal(bookingsOnly(byCode)[0].code, "RD-BBBB2222");

    const byPhone = await (await search(db, cookie, "0971112233")).json();
    assert.ok(bookingsOnly(byPhone).some((r) => r.code === "RD-AAAA1111"));
    assert.equal(bookingsOnly(byPhone)[0].phone, "+380971112233");
    assert.ok(bookingsOnly(byPhone)[0].statusLabel);
  });
});

test("a query shorter than 2 chars returns nothing (no full-table dump)", async () => {
  await withD1(async (db) => {
    await seed(db, { id: 3, code: "RD-CCCC3333", name: "Сидоренко", phone: "+380971110000", phoneNorm: "380971110000" });
    const cookie = await seedStaffSession(db, { email: "reg@likarnya.test", role: "registrar" });
    const data = await (await search(db, cookie, "і")).json();
    assert.equal(data.results.length, 0);
  });
});

test("search never leaks bookings from another organization", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2,'other','Інша',1)").run();
    await seed(db, { id: 4, code: "RD-OWN00001", name: "Шевченко", phone: "+380971110001", phoneNorm: "380971110001", org: 1 });
    await seed(db, { id: 5, code: "RD-OTHER0001", name: "Шевченко", phone: "+380971110002", phoneNorm: "380971110002", org: 2 });
    const cookie = await seedStaffSession(db, { email: "admin@likarnya.test", role: "admin" });
    const data = await (await search(db, cookie, "шевченко")).json();
    assert.equal(bookingsOnly(data).length, 1);
    assert.equal(bookingsOnly(data)[0].code, "RD-OWN00001");
  });
});

test("clinician search is limited to bookings assigned to that membership", async () => {
  await withD1(async (db) => {
    await seed(db, { id: 6, code: "RD-OWNRAD01", name: "Контрольний Пацієнт", phone: "+380971110006", phoneNorm: "380971110006", time: "10:00" });
    await seed(db, { id: 7, code: "RD-OTHERRAD", name: "Контрольний Інший", phone: "+380971110007", phoneNorm: "380971110007", time: "10:30" });
    const radEmail = "rad@likarnya.test";
    const cookie = await seedStaffSession(db, { email: radEmail, role: "radiologist" });
    await db.prepare("UPDATE bookings SET assigned_radiologist_email = ? WHERE id = 6").bind(radEmail).run();
    await db.prepare("UPDATE bookings SET assigned_radiologist_email = 'someone-else@likarnya.test' WHERE id = 7").run();

    const data = await (await search(db, cookie, "контрольний")).json();
    assert.deepEqual(bookingsOnly(data).map((r) => r.bookingId), [6]);
  });
});

test("clinicians can find assigned bookings by phone without receiving the phone field", async () => {
  await withD1(async (db) => {
    await seed(db, { id: 8, code: "RD-RADPHONE", name: "Рентгенолог Пацієнт", phone: "+380971110008", phoneNorm: "380971110008", time: "11:00" });
    await seed(db, { id: 9, code: "RD-TECHPHONE", name: "Лаборант Пацієнт", phone: "+380971110009", phoneNorm: "380971110009", time: "11:30" });

    const cases = [
      { role: "radiologist", email: "rad-phone@likarnya.test", bookingId: 8, field: "assigned_radiologist_email", query: "0971110008" },
      { role: "radiographer", email: "tech-phone@likarnya.test", bookingId: 9, field: "assigned_radiographer_email", query: "0971110009" },
    ];

    for (const item of cases) {
      const cookie = await seedStaffSession(db, { email: item.email, role: item.role });
      await db.prepare(`UPDATE bookings SET ${item.field} = ? WHERE id = ?`).bind(item.email, item.bookingId).run();
      const data = await (await search(db, cookie, item.query)).json();
      const booking = bookingsOnly(data).find((r) => r.bookingId === item.bookingId);
      assert.ok(booking);
      assert.equal(Object.hasOwn(booking, "phone"), false);
    }
  });
});

test("global search includes accession, protocol, equipment and maintenance for authorized staff", async () => {
  await withD1(async (db) => {
    await seed(db, { id: 10, code: "RD-GLOBAL10", name: "Глобальний Тест", phone: "+380971110010", phoneNorm: "380971110010" });
    await db.prepare(`INSERT INTO imaging_studies (booking_id, accession_number, modality, study_status, study_datetime, updated_by)
      VALUES (10,'ACC-XYZ-999','CT','linked','2026-09-01 10:00','admin@test')`).run();
    await db.prepare(`INSERT INTO protocols (booking_id, findings, conclusion, number, status, updated_by)
      VALUES (10,'Без особливостей','Унікальний висновок глобального пошуку','PR-777','issued','admin@test')`).run();
    await db.prepare(`INSERT INTO equipment_maintenance
      (organization_id,equipment_id,event_type,status,title,details,created_by)
      VALUES (1,'siemens-somatom','fault','open','Помилка E09 стабілізатора','Перевірити живлення','admin@test')`).run();
    const cookie = await seedStaffSession(db, { email: "admin-global@likarnya.test", role: "admin" });

    const imaging = await (await search(db, cookie, "ACC-XYZ")).json();
    assert.ok(imaging.results.some((r) => r.type === "imaging" && r.bookingId === 10));

    const protocol = await (await search(db, cookie, "унікальний")).json();
    assert.ok(protocol.results.some((r) => r.type === "protocol" && r.bookingId === 10));

    const equipment = await (await search(db, cookie, "somatom")).json();
    assert.ok(equipment.results.some((r) => r.type === "equipment"));

    const maintenance = await (await search(db, cookie, "E09")).json();
    assert.ok(maintenance.results.some((r) => r.type === "maintenance"));
  });
});

test("global search source enforces role scopes and never searches Study Instance UID", async () => {
  const route = await read("app/api/staff/search/route.ts");
  assert.match(route, /assigned_radiologist_email = \?/);
  assert.match(route, /assigned_radiographer_email = \?/);
  assert.match(route, /canManageProtocols\(role\)/);
  assert.match(route, /canManageImaging\(role\)/);
  assert.match(route, /FROM equipment_maintenance/);
  assert.doesNotMatch(route, /study_instance_uid\s+LIKE/i);
});

test("the palette is mounted in the workspace shell and renders typed global results", async () => {
  const shell = await read("app/staff/workspace-shell.tsx");
  assert.match(shell, /import CommandPalette from "\.\/command-palette"/);
  assert.match(shell, /<CommandPalette \/>/);
  const cp = await read("app/staff/command-palette.tsx");
  assert.match(cp, /e\.metaKey \|\| e\.ctrlKey/);
  assert.match(cp, /\/api\/staff\/search/);
  assert.match(cp, /TYPE_LABEL/);
  assert.match(cp, /accession, протокол, обладнання/);
  assert.match(cp, /window\.location\.assign\(r\.href\)/);
});
