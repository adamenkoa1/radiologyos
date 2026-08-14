// Поведінковий тест вибору каналів сповіщення через /api/staff/notify:
// повага до «не турбувати», tenant-ізоляція, поведінка без налаштованих шлюзів.
// Свідомо перевіряємо лише детерміновані гілки (без реальних мережевих викликів).

import assert from "node:assert/strict";
import test from "node:test";
import { withD1, jsonRequest, callWorker, seedStaffSession } from "./helpers/d1.mjs";

async function seedBooking(db, { id = 1, phoneNormalized = "380971112233", orgId = 1, email = "" } = {}) {
  await db.prepare(
    `INSERT INTO bookings (id, code, name, phone, phone_normalized, patient_email, service, service_code,
       desired_date, desired_time, status, date_of_birth, patient_category, organization_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, `RD-NOTIFY${String(id).padStart(4, "0")}`, "Пацієнт", "+" + phoneNormalized, phoneNormalized,
    email, "КТ", "CT-01", "2026-09-01", "10:00", "confirmed", "1990-05-05", "civilian", orgId).run();
}

const notify = (db, cookie, bookingId, message = "Ваш результат готовий") =>
  callWorker(jsonRequest("/api/staff/notify", { bookingId, message }, { headers: { cookie } }), db);

test("do-not-contact is respected: message is skipped, nothing sent", async () => {
  await withD1(async (db) => {
    await seedBooking(db, { id: 1, phoneNormalized: "380971112233" });
    await db.prepare(
      "INSERT INTO patient_profiles (organization_id, phone_normalized, do_not_contact, updated_by) VALUES (1, ?, 1, 'test')"
    ).bind("380971112233").run();
    const cookie = await seedStaffSession(db, { email: "reg@likarnya.test", role: "registrar" });
    const res = await notify(db, cookie, 1);
    assert.equal(res.status, 200);
    const { summary } = await res.json();
    assert.equal(summary.sent, 0);
    assert.ok(summary.skipped >= 1, "має бути пропущено через «не турбувати»");
    const sent = await db.prepare("SELECT COUNT(*) AS n FROM patient_notifications WHERE status = 'sent'").first("n");
    assert.equal(sent, 0);
    const skipped = await db.prepare("SELECT COUNT(*) AS n FROM patient_notifications WHERE status = 'skipped'").first("n");
    assert.ok(skipped >= 1);
  });
});

test("with no gateways configured nothing is sent (channel gated on config)", async () => {
  await withD1(async (db) => {
    await seedBooking(db, { id: 2, phoneNormalized: "380972223344" });
    const cookie = await seedStaffSession(db, { email: "reg@likarnya.test", role: "registrar" });
    const res = await notify(db, cookie, 2);
    assert.equal(res.status, 200);
    const { summary } = await res.json();
    assert.equal(summary.sent, 0);
    assert.equal(summary.failed, 0);
    assert.ok(summary.skipped >= 1);
  });
});

test("a message to a booking in another organization is not found (tenant isolation)", async () => {
  await withD1(async (db) => {
    await db.prepare(
      "INSERT INTO organizations (id, slug, name, active) VALUES (2, 'other', 'Інша', 1)"
    ).run();
    await seedBooking(db, { id: 3, phoneNormalized: "380973334455", orgId: 2 });
    const cookie = await seedStaffSession(db, { email: "admin2@likarnya.test", role: "admin" });
    const res = await notify(db, cookie, 3);
    assert.equal(res.status, 404);
  });
});

test("a clinical role may still send an ad-hoc message (canWriteNotes)", async () => {
  await withD1(async (db) => {
    await seedBooking(db, { id: 4, phoneNormalized: "380974445566" });
    const cookie = await seedStaffSession(db, { email: "rad@likarnya.test", role: "radiologist" });
    const res = await notify(db, cookie, 4);
    assert.equal(res.status, 200);
  });
});

test("same phone in another tenant does not inherit DNC and outbox stays in booking tenant", async () => {
  await withD1(async (db) => {
    const phone = "380975556677";
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'notify-two', 'Notify Two', 1)").run();
    await db.prepare(
      `INSERT INTO patient_profiles (organization_id, phone_normalized, display_name, do_not_contact, updated_by)
       VALUES (1, ?, 'Org1 Patient', 1, 'test'), (2, ?, 'Org2 Patient', 0, 'test')`
    ).bind(phone, phone).run();
    await seedBooking(db, { id: 5, phoneNormalized: phone, orgId: 2 });
    const cookie = await seedStaffSession(db, { email: "reg-org2@likarnya.test", role: "registrar", organizationId: 2 });

    const res = await notify(db, cookie, 5);
    assert.equal(res.status, 200);
    const { summary } = await res.json();
    assert.equal(summary.sent, 0);
    assert.ok(summary.skipped >= 1);

    const rows = await db.prepare(
      `SELECT organization_id AS organizationId, error
       FROM patient_notifications WHERE booking_id = 5 ORDER BY id`
    ).all();
    assert.ok(rows.results.length >= 1);
    assert.ok(rows.results.every((row) => row.organizationId === 2));
    assert.ok(rows.results.every((row) => !String(row.error).includes("не турбувати")));
  });
});
