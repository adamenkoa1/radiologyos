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
    const sql = await readFile(new URL(file, DRIZZLE_DIR), "utf8");
    db.exec(sql);
  }
}

test("0050 backfills opaque immutable patient ids without changing legacy profile data", async () => {
  const files = await migrationFiles();
  const before0050 = files.filter((file) => migrationNumber(file) < 50);
  const migration0050 = files.find((file) => migrationNumber(file) === 50);
  assert.ok(migration0050);

  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    await apply(db, before0050);
    db.prepare(
      `INSERT INTO patient_profiles
        (organization_id, phone_normalized, display_name, birth_year, birth_date,
         email, address, tags, notes, do_not_contact, telegram_chat_id, updated_by)
       VALUES (1, '380501112233', 'Legacy Person', 1980, '1980-01-10',
         'legacy@example.com', 'Address', 'vip', 'note', 1, 'legacy-chat', 'seed')`,
    ).run();

    await apply(db, [migration0050]);

    const row = db.prepare(
      `SELECT patient_id AS patientId, organization_id AS organizationId,
        phone_normalized AS phone, display_name AS displayName, birth_date AS birthDate,
        email, address, tags, notes, do_not_contact AS doNotContact,
        telegram_chat_id AS telegramChatId, updated_by AS updatedBy
       FROM patient_profiles WHERE organization_id = 1 AND phone_normalized = '380501112233'`,
    ).get();
    assert.match(String(row.patientId), /^[0-9a-f]{32}$/);
    assert.deepEqual(
      { ...row, patientId: undefined },
      {
        patientId: undefined,
        organizationId: 1,
        phone: "380501112233",
        displayName: "Legacy Person",
        birthDate: "1980-01-10",
        email: "legacy@example.com",
        address: "Address",
        tags: "vip",
        notes: "note",
        doNotContact: 1,
        telegramChatId: "legacy-chat",
        updatedBy: "seed",
      },
    );

    assert.throws(
      () => db.prepare("UPDATE patient_profiles SET patient_id = 'changed' WHERE patient_id = ?").run(row.patientId),
      /patient id is immutable/i,
    );

    db.prepare(
      `INSERT INTO patient_profiles (organization_id, phone_normalized, display_name, updated_by)
       VALUES (2, '380501112233', 'Other tenant', 'seed')`,
    ).run();
    const otherId = db.prepare(
      "SELECT patient_id AS patientId FROM patient_profiles WHERE organization_id = 2 AND phone_normalized = '380501112233'",
    ).get().patientId;
    assert.match(String(otherId), /^[0-9a-f]{32}$/);
    assert.notEqual(otherId, row.patientId);

    assert.throws(
      () => db.prepare(
        `INSERT INTO patient_profiles (organization_id, phone_normalized, display_name, updated_by)
         VALUES (1, '380501112233', 'Duplicate', 'seed')`,
      ).run(),
      /UNIQUE constraint failed/i,
    );
  } finally {
    db.close();
  }
});

test("patient registry returns a stable patient id and never audits the phone as target id", async () => {
  await withD1(async (db, raw) => {
    const cookie = await seedStaffSession(db, {
      email: "registry@example.com",
      role: "registrar",
      displayName: "Registry User",
    });

    const create = await callWorker(
      jsonRequest("/api/staff/patients", {
        phone: "+380 50 111 22 33",
        displayName: "Patient One",
        birthDate: "1980-01-10",
        email: "patient@example.com",
      }, { method: "PUT", headers: { cookie } }),
      db,
    );
    assert.equal(create.status, 200);
    const created = await create.json();
    assert.match(String(created.profile?.patientId || ""), /^[0-9a-f]{32}$/);
    const patientId = created.profile.patientId;

    const update = await callWorker(
      jsonRequest("/api/staff/patients", {
        phone: "+380 50 111 22 33",
        displayName: "Patient One Updated",
        birthDate: "1980-01-10",
        email: "patient@example.com",
      }, { method: "PUT", headers: { cookie } }),
      db,
    );
    assert.equal(update.status, 200);
    const updated = await update.json();
    assert.equal(updated.profile.patientId, patientId, "profile updates must preserve immutable identity");

    const get = await callWorker(
      jsonRequest("/api/staff/patients?phone=380501112233", undefined, {
        method: "GET",
        headers: { cookie },
      }),
      db,
    );
    assert.equal(get.status, 200);
    const card = await get.json();
    assert.equal(card.profile.patientId, patientId);

    const audit = raw.prepare(
      `SELECT target_id AS targetId
       FROM security_audit_log
       WHERE action = 'patient_record_viewed'
       ORDER BY id DESC LIMIT 1`,
    ).get();
    assert.equal(audit.targetId, patientId);
    assert.notEqual(audit.targetId, "380501112233");

    const booking = await db.prepare(
      `INSERT INTO bookings
        (organization_id, code, name, phone, phone_normalized, date_of_birth,
         service, service_code, equipment_id, desired_date, desired_time)
       VALUES (1, 'RD-UNLINKED-PATIENT', 'Booking Only', '+380671234567', '380671234567',
         '1990-02-02', 'КТ', '403', 'ct', '2026-09-10', '10:00')`,
    ).run();
    const bookingId = Number(booking.meta.last_row_id);

    const bookingOnly = await callWorker(
      jsonRequest("/api/staff/patients?phone=380671234567", undefined, {
        method: "GET",
        headers: { cookie },
      }),
      db,
    );
    assert.equal(bookingOnly.status, 200);
    const bookingAudit = raw.prepare(
      `SELECT target_id AS targetId
       FROM security_audit_log
       WHERE action = 'patient_record_viewed'
       ORDER BY id DESC LIMIT 1`,
    ).get();
    assert.equal(bookingAudit.targetId, `booking:${bookingId}`);
    assert.notEqual(bookingAudit.targetId, "380671234567");
  });
});
