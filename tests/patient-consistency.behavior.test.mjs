// Аудит неузгодженостей карток: end-to-end через воркер із реальним D1.

import assert from "node:assert/strict";
import test from "node:test";
import { withD1, callWorker, jsonRequest, seedStaffSession } from "./helpers/d1.mjs";

const PID = (c) => c.repeat(32);

async function profile(db, patientId, phone, name) {
  await db.prepare(
    `INSERT INTO patient_profiles (patient_id, organization_id, phone_normalized, display_name, updated_by)
     VALUES (?, 1, ?, ?, 'test')`
  ).bind(patientId, phone, name).run();
}
async function booking(db, code, name, phone, patientId, time) {
  const r = await db.prepare(
    `INSERT INTO bookings (organization_id, code, name, phone, phone_normalized, patient_id,
       service, desired_date, desired_time, status)
     VALUES (1, ?, ?, ?, ?, ?, 'КТ', '2026-07-15', ?, 'confirmed')`
  ).bind(code, name, `+${phone}`, phone, patientId, time).run();
  return Number(r.meta.last_row_id);
}

test("issues route surfaces stale contact, duplicate phone, linkable booking and name divergence", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email: "reg@example.com", role: "registrar", organizationId: 1 });

    // Розбіжність контакту: заявка привʼязана до картки, але телефон інший.
    await profile(db, PID("a"), "380501112233", "Іваненко Іван");
    const staleBooking = await booking(db, "RD-STALE", "Іваненко Іван", "380509998877", PID("a"), "10:00");

    // Спільний номер у двох карток.
    await profile(db, PID("b"), "380502223344", "Родина Один");
    await profile(db, PID("c"), "380502223344", "Родина Два");

    // Неприв'язана заявка збігається рівно з однією карткою.
    await profile(db, PID("d"), "380503334455", "Сидоренко Сидір");
    const linkBooking = await booking(db, "RD-LINK", "Сидір С.", "380503334455", "", "11:00");

    // Розбіжність ПІБ на привʼязаній заявці (телефон збігається, ПІБ інше).
    await profile(db, PID("e"), "380504445566", "Коваленко Микола");
    const nameBooking = await booking(db, "RD-NAME", "Петренко Микола", "380504445566", PID("e"), "12:00");

    const res = await callWorker(
      jsonRequest("/api/staff/patients/issues", undefined, { method: "GET", headers: { cookie } }),
      db,
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    const byKind = (k) => body.findings.filter((f) => f.kind === k);

    const stale = byKind("stale_contact");
    assert.equal(stale.length, 1);
    assert.equal(stale[0].bookingId, staleBooking);
    assert.equal(stale[0].severity, "high");

    const dup = byKind("duplicate_phone");
    assert.equal(dup.length, 1);
    assert.equal(dup[0].phoneNormalized, "380502223344");

    const link = byKind("linkable_booking");
    assert.equal(link.length, 1);
    assert.equal(link[0].bookingId, linkBooking);
    assert.equal(link[0].patientId, PID("d"));

    const name = byKind("name_divergence");
    assert.equal(name.length, 1);
    assert.equal(name[0].bookingId, nameBooking);

    // Найвища серйозність — першою.
    assert.equal(body.findings[0].severity, "high");
    assert.equal(body.counts.total, body.findings.length);
    assert.ok(body.counts.high >= 1 && body.counts.medium >= 2 && body.counts.low >= 1);
  });
});

test("issues route is denied to roles without registry access", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email: "rad@example.com", role: "radiographer", organizationId: 1 });
    const res = await callWorker(
      jsonRequest("/api/staff/patients/issues", undefined, { method: "GET", headers: { cookie } }),
      db,
    );
    assert.equal(res.status, 403);
  });
});

async function fullProfile(db, patientId, phone, name, { contrast = 0, dnc = 0, note = "" } = {}) {
  await db.prepare(
    `INSERT INTO patient_profiles (patient_id, organization_id, phone_normalized, display_name,
       contrast_alert, do_not_contact, allergy_note, updated_by)
     VALUES (?, 1, ?, ?, ?, ?, ?, 'test')`
  ).bind(patientId, phone, name, contrast, dnc, note).run();
}

test("merge re-points history to the survivor, unions safety flags and deletes absorbed cards", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email: "boss@example.com", role: "admin", organizationId: 1 });
    const survivorId = PID("a"), absorbedId = PID("b");
    await fullProfile(db, survivorId, "380501112233", "Іваненко Іван", { contrast: 0, dnc: 0, note: "" });
    await fullProfile(db, absorbedId, "380501112233", "Іваненко І.", { contrast: 1, dnc: 1, note: "Йодовмісний контраст" });

    const bId = await booking(db, "RD-M1", "Іваненко Іван", "380501112233", absorbedId, "09:00");
    await db.prepare(
      `INSERT INTO patient_communications (organization_id, patient_id, phone_normalized, channel, direction, summary, actor)
       VALUES (1, ?, '380501112233', 'call', 'outbound', 'дзвінок', 'test')`
    ).bind(absorbedId).run();

    const res = await callWorker(jsonRequest("/api/staff/patients/issues",
      { survivorId, absorbedIds: [absorbedId] }, { method: "POST", headers: { cookie } }), db);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);

    // Поглинуту картку видалено, головна лишилась.
    const gone = await db.prepare("SELECT patient_id FROM patient_profiles WHERE patient_id = ?").bind(absorbedId).first();
    assert.equal(gone, null);
    const kept = await db.prepare(
      "SELECT contrast_alert AS c, do_not_contact AS d, allergy_note AS n FROM patient_profiles WHERE patient_id = ?"
    ).bind(survivorId).first();
    assert.equal(kept.c, 1); // прапорець контрасту перейшов
    assert.equal(kept.d, 1); // «не турбувати» перейшов
    assert.equal(kept.n, "Йодовмісний контраст"); // нотатка алергій збережена

    // Історія перепризначена головній.
    const bk = await db.prepare("SELECT patient_id AS p FROM bookings WHERE id = ?").bind(bId).first();
    assert.equal(bk.p, survivorId);
    const comm = await db.prepare("SELECT COUNT(*) AS n FROM patient_communications WHERE patient_id = ?").bind(survivorId).first();
    assert.equal(comm.n, 1);
  });
});

test("merge is denied to non-admin roles and validates input", async () => {
  await withD1(async (db) => {
    const survivorId = PID("a"), absorbedId = PID("b");
    await fullProfile(db, survivorId, "380501112233", "A");
    await fullProfile(db, absorbedId, "380501112233", "B");

    const reg = await seedStaffSession(db, { email: "reg@example.com", role: "registrar", organizationId: 1 });
    const denied = await callWorker(jsonRequest("/api/staff/patients/issues",
      { survivorId, absorbedIds: [absorbedId] }, { method: "POST", headers: { cookie: reg } }), db);
    assert.equal(denied.status, 403); // реєстратор не може обʼєднувати

    const admin = await seedStaffSession(db, { email: "boss@example.com", role: "admin", organizationId: 1 });
    const selfMerge = await callWorker(jsonRequest("/api/staff/patients/issues",
      { survivorId, absorbedIds: [survivorId] }, { method: "POST", headers: { cookie: admin } }), db);
    assert.equal(selfMerge.status, 400); // не можна приєднати картку до себе
  });
});

test("merge refuses cards from another organization", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'other', 'Other', 1)").run();
    const cookie = await seedStaffSession(db, { email: "boss@example.com", role: "admin", organizationId: 1 });
    const survivorId = PID("a"), foreignId = PID("f");
    await fullProfile(db, survivorId, "380501112233", "Свій");
    await db.prepare(
      `INSERT INTO patient_profiles (patient_id, organization_id, phone_normalized, display_name, updated_by)
       VALUES (?, 2, '380501112233', 'Чужий', 'test')`
    ).bind(foreignId).run();

    const res = await callWorker(jsonRequest("/api/staff/patients/issues",
      { survivorId, absorbedIds: [foreignId] }, { method: "POST", headers: { cookie } }), db);
    assert.equal(res.status, 404); // чужа картка не знайдена в організації актора
    const stillThere = await db.prepare("SELECT patient_id FROM patient_profiles WHERE patient_id = ?").bind(foreignId).first();
    assert.ok(stillThere); // і не видалена
  });
});

test("issues route isolates findings by organization", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'other', 'Other', 1)").run();
    const cookie = await seedStaffSession(db, { email: "reg@example.com", role: "registrar", organizationId: 1 });

    // Проблемна пара карток — у ЧУЖІЙ організації.
    await db.prepare(
      `INSERT INTO patient_profiles (patient_id, organization_id, phone_normalized, display_name, updated_by)
       VALUES (?, 2, '380507778899', 'Чужий Один', 'test')`
    ).bind(PID("f")).run();
    await db.prepare(
      `INSERT INTO patient_profiles (patient_id, organization_id, phone_normalized, display_name, updated_by)
       VALUES (?, 2, '380507778899', 'Чужий Два', 'test')`
    ).bind(PID("0")).run();

    const res = await callWorker(
      jsonRequest("/api/staff/patients/issues", undefined, { method: "GET", headers: { cookie } }),
      db,
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.counts.total, 0); // чужі неузгодженості не видно
  });
});
