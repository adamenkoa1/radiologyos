import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const DRIZZLE_DIR = new URL("../drizzle/", import.meta.url);

function migrationNumber(file) {
  return Number(file.slice(0, 4));
}

async function migrationFiles() {
  return (await readdir(DRIZZLE_DIR))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();
}

async function apply(db, files) {
  for (const file of files) {
    db.exec(await readFile(new URL(file, DRIZZLE_DIR), "utf8"));
  }
}

test("0051 leaves historical bookings unlinked instead of guessing identity from phone", async () => {
  const files = await migrationFiles();
  const before0051 = files.filter((file) => migrationNumber(file) <= 50);
  const migration0051 = files.find((file) => migrationNumber(file) === 51);
  assert.ok(migration0051);

  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    await apply(db, before0051);

    db.prepare(
      `INSERT INTO patient_profiles
        (organization_id, phone_normalized, display_name, birth_date, updated_by)
       VALUES (1, '380501112233', 'Existing Profile', '1980-01-10', 'seed')`,
    ).run();
    db.prepare(
      `INSERT INTO bookings
        (organization_id, code, name, phone, phone_normalized, date_of_birth,
         service, service_code, desired_date, desired_time)
       VALUES (1, 'RD-PRELINK-01', 'Historical Booking', '+380501112233', '380501112233',
         '1980-01-10', 'КТ', '403', '2026-09-10', '10:00')`,
    ).run();

    await apply(db, [migration0051]);

    const booking = db.prepare(
      "SELECT patient_id AS patientId FROM bookings WHERE code = 'RD-PRELINK-01'",
    ).get();
    assert.equal(booking.patientId, "", "phone/DOB similarity must not become identity evidence during migration");
  } finally {
    db.close();
  }
});

test("D1 enforces same-tenant patient links and protects linked identities", async () => {
  await withD1(async (db, raw) => {
    db.prepare(
      `INSERT INTO patient_profiles
        (organization_id, phone_normalized, display_name, updated_by)
       VALUES (1, '380501112233', 'Tenant One', 'seed')`,
    ).run();
    db.prepare(
      `INSERT INTO patient_profiles
        (organization_id, phone_normalized, display_name, updated_by)
       VALUES (2, '380501112233', 'Tenant Two', 'seed')`,
    ).run();
    const p1 = raw.prepare(
      "SELECT patient_id AS patientId FROM patient_profiles WHERE organization_id = 1 AND phone_normalized = '380501112233'",
    ).get().patientId;
    const p2 = raw.prepare(
      "SELECT patient_id AS patientId FROM patient_profiles WHERE organization_id = 2 AND phone_normalized = '380501112233'",
    ).get().patientId;

    const booking = db.prepare(
      `INSERT INTO bookings
        (organization_id, code, name, phone, phone_normalized,
         service, service_code, desired_date, desired_time)
       VALUES (1, 'RD-LINK-D1', 'Booking One', '+380501112233', '380501112233',
         'КТ', '403', '2026-09-11', '10:00')`,
    );
    await booking.run();
    const bookingId = raw.prepare("SELECT id FROM bookings WHERE code = 'RD-LINK-D1'").get().id;

    assert.throws(
      () => raw.prepare("UPDATE bookings SET patient_id = ? WHERE id = ?").run(p2, bookingId),
      /booking patient link invalid/i,
    );
    raw.prepare("UPDATE bookings SET patient_id = ? WHERE id = ?").run(p1, bookingId);
    assert.equal(raw.prepare("SELECT patient_id AS patientId FROM bookings WHERE id = ?").get(bookingId).patientId, p1);

    assert.throws(
      () => raw.prepare("UPDATE patient_profiles SET organization_id = 2 WHERE patient_id = ?").run(p1),
      /patient organization is immutable/i,
    );
    assert.throws(
      () => raw.prepare("DELETE FROM patient_profiles WHERE patient_id = ?").run(p1),
      /linked patient cannot be deleted/i,
    );
  });
});

test("registrar can explicitly link an unlinked tenant booking; clinicians and cross-tenant ids cannot", async () => {
  await withD1(async (db, raw) => {
    const registrarCookie = await seedStaffSession(db, {
      email: "link-registrar@example.com",
      role: "registrar",
      displayName: "Registrar",
      organizationId: 1,
    });
    const radiologistCookie = await seedStaffSession(db, {
      email: "link-radiologist@example.com",
      role: "radiologist",
      displayName: "Radiologist",
      organizationId: 1,
    });

    await db.prepare(
      `INSERT INTO patient_profiles
        (organization_id, phone_normalized, display_name, updated_by)
       VALUES (1, '380501112233', 'Exact Patient', 'seed')`,
    ).run();
    await db.prepare(
      `INSERT INTO patient_profiles
        (organization_id, phone_normalized, display_name, updated_by)
       VALUES (1, '380671234567', 'Other Patient', 'seed')`,
    ).run();
    await db.prepare(
      `INSERT INTO patient_profiles
        (organization_id, phone_normalized, display_name, updated_by)
       VALUES (2, '380931234567', 'Other Tenant Patient', 'seed')`,
    ).run();
    const patientId = raw.prepare(
      "SELECT patient_id AS patientId FROM patient_profiles WHERE organization_id = 1 AND phone_normalized = '380501112233'",
    ).get().patientId;
    const otherPatientId = raw.prepare(
      "SELECT patient_id AS patientId FROM patient_profiles WHERE organization_id = 1 AND phone_normalized = '380671234567'",
    ).get().patientId;
    const crossTenantPatientId = raw.prepare(
      "SELECT patient_id AS patientId FROM patient_profiles WHERE organization_id = 2 AND phone_normalized = '380931234567'",
    ).get().patientId;

    await db.prepare(
      `INSERT INTO bookings
        (organization_id, code, name, phone, phone_normalized,
         service, service_code, desired_date, desired_time)
       VALUES (1, 'RD-LINK-API', 'Booking Patient', '+380501112233', '380501112233',
         'КТ', '403', '2026-09-12', '10:00')`,
    ).run();
    const bookingId = raw.prepare("SELECT id FROM bookings WHERE code = 'RD-LINK-API'").get().id;

    const denied = await callWorker(
      jsonRequest("/api/staff/patients/link-booking", { bookingId, patientId }, {
        method: "POST",
        headers: { cookie: radiologistCookie },
      }),
      db,
    );
    assert.equal(denied.status, 403);
    assert.equal(raw.prepare("SELECT patient_id AS patientId FROM bookings WHERE id = ?").get(bookingId).patientId, "");

    const crossTenant = await callWorker(
      jsonRequest("/api/staff/patients/link-booking", { bookingId, patientId: crossTenantPatientId }, {
        method: "POST",
        headers: { cookie: registrarCookie },
      }),
      db,
    );
    assert.equal(crossTenant.status, 404);
    assert.equal(raw.prepare("SELECT patient_id AS patientId FROM bookings WHERE id = ?").get(bookingId).patientId, "");

    const linked = await callWorker(
      jsonRequest("/api/staff/patients/link-booking", { bookingId, patientId }, {
        method: "POST",
        headers: { cookie: registrarCookie },
      }),
      db,
    );
    assert.equal(linked.status, 200);
    const linkedBody = await linked.json();
    assert.equal(linkedBody.patientId, patientId);
    assert.equal(raw.prepare("SELECT patient_id AS patientId FROM bookings WHERE id = ?").get(bookingId).patientId, patientId);

    const idempotent = await callWorker(
      jsonRequest("/api/staff/patients/link-booking", { bookingId, patientId }, {
        method: "POST",
        headers: { cookie: registrarCookie },
      }),
      db,
    );
    assert.equal(idempotent.status, 200);

    const reassign = await callWorker(
      jsonRequest("/api/staff/patients/link-booking", { bookingId, patientId: otherPatientId }, {
        method: "POST",
        headers: { cookie: registrarCookie },
      }),
      db,
    );
    assert.equal(reassign.status, 409);
    assert.equal(raw.prepare("SELECT patient_id AS patientId FROM bookings WHERE id = ?").get(bookingId).patientId, patientId);

    const event = raw.prepare(
      "SELECT action, details FROM booking_events WHERE booking_id = ? AND action = 'patient_linked' ORDER BY id DESC LIMIT 1",
    ).get(bookingId);
    assert.equal(event.action, "patient_linked");
    assert.match(event.details, new RegExp(patientId));
    assert.doesNotMatch(event.details, /380501112233/);

    const audit = raw.prepare(
      "SELECT target_id AS targetId, details_json AS detailsJson FROM security_audit_log WHERE action = 'booking_patient_linked' ORDER BY id DESC LIMIT 1",
    ).get();
    assert.equal(audit.targetId, String(bookingId));
    assert.match(audit.detailsJson, new RegExp(patientId));
    assert.doesNotMatch(audit.detailsJson, /380501112233/);
  });
});
