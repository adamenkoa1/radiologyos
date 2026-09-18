import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const PHONE = "380501112233";

async function putPatient(db, cookie, body) {
  return callWorker(
    jsonRequest("/api/staff/patients", body, { method:"PUT", headers:{ cookie } }),
    db,
  );
}

async function getPatients(db, cookie, query = "") {
  return callWorker(
    jsonRequest(`/api/staff/patients${query ? `?${query}` : ""}`, undefined, { method:"GET", headers:{ cookie } }),
    db,
  );
}

test("D1 allows two immutable patient profiles in one tenant to share one phone", async () => {
  await withD1(async (db, raw) => {
    await db.prepare(
      `INSERT INTO patient_profiles
        (organization_id, phone_normalized, display_name, updated_by)
       VALUES (1, ?, 'Patient One', 'seed')`,
    ).bind(PHONE).run();
    await db.prepare(
      `INSERT INTO patient_profiles
        (organization_id, phone_normalized, display_name, updated_by)
       VALUES (1, ?, 'Patient Two', 'seed')`,
    ).bind(PHONE).run();

    const profiles = raw.prepare(
      `SELECT patient_id AS patientId, display_name AS displayName
       FROM patient_profiles WHERE organization_id = 1 AND phone_normalized = ?
       ORDER BY display_name`,
    ).all(PHONE);
    assert.equal(profiles.length, 2);
    assert.notEqual(profiles[0].patientId, profiles[1].patientId);
    assert.match(profiles[0].patientId, /^[0-9a-f]{32}$/);
    assert.match(profiles[1].patientId, /^[0-9a-f]{32}$/);

    await assert.rejects(
      db.prepare("UPDATE patient_profiles SET patient_id = ? WHERE patient_id = ?")
        .bind("f".repeat(32), profiles[0].patientId).run(),
      /patient id is immutable/i,
    );
  });
});

test("CRM keeps shared-phone exact patients separate and leaves unlinked history legacy", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, {
      email:"shared-phone-registrar@example.com",
      role:"registrar",
      organizationId:1,
    });

    const firstResponse = await putPatient(db, cookie, {
      phone:`+${PHONE}`,
      displayName:"Анна Родина",
      birthDate:"1980-01-10",
    });
    const secondResponse = await putPatient(db, cookie, {
      phone:`+${PHONE}`,
      displayName:"Богдан Родина",
      birthDate:"2000-02-20",
    });
    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);
    const first = await firstResponse.json();
    const second = await secondResponse.json();
    const firstId = first.profile.patientId;
    const secondId = second.profile.patientId;
    assert.notEqual(firstId, secondId);

    await db.prepare(
      `INSERT INTO bookings
        (organization_id, patient_id, code, name, phone, phone_normalized, date_of_birth,
         service, service_code, desired_date, desired_time, status)
       VALUES (1, ?, 'RD-SHARED-ONE', 'Анна Родина', ?, ?, '1980-01-10',
         'КТ', '403', '2026-09-01', '10:00', 'completed')`,
    ).bind(firstId, `+${PHONE}`, PHONE).run();
    await db.prepare(
      `INSERT INTO bookings
        (organization_id, patient_id, code, name, phone, phone_normalized, date_of_birth,
         service, service_code, desired_date, desired_time, status)
       VALUES (1, ?, 'RD-SHARED-TWO', 'Богдан Родина', ?, ?, '2000-02-20',
         'КТ', '403', '2026-09-02', '11:00', 'confirmed')`,
    ).bind(secondId, `+${PHONE}`, PHONE).run();
    await db.prepare(
      `INSERT INTO bookings
        (organization_id, code, name, phone, phone_normalized, date_of_birth,
         service, service_code, desired_date, desired_time, status)
       VALUES (1, 'RD-SHARED-LEGACY', 'Legacy Shared Phone', ?, ?, '1970-03-03',
         'КТ', '403', '2026-08-01', '09:00', 'completed')`,
    ).bind(`+${PHONE}`, PHONE).run();

    const listResponse = await getPatients(db, cookie);
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    const samePhone = list.patients.filter((item) => item.phoneNormalized === PHONE);
    assert.equal(samePhone.length, 3, "two exact cards plus one unlinked legacy group must remain distinct");

    const firstSummary = samePhone.find((item) => item.patientId === firstId);
    const secondSummary = samePhone.find((item) => item.patientId === secondId);
    const legacySummary = samePhone.find((item) => item.patientId === "");
    assert.equal(firstSummary.name, "Анна Родина");
    assert.equal(firstSummary.visits, 1);
    assert.equal(secondSummary.name, "Богдан Родина");
    assert.equal(secondSummary.visits, 1);
    assert.equal(legacySummary.name, "Legacy Shared Phone");
    assert.equal(legacySummary.visits, 1);

    const ambiguous = await getPatients(db, cookie, `phone=${PHONE}`);
    assert.equal(ambiguous.status, 409);
    const ambiguousBody = await ambiguous.json();
    assert.equal(ambiguousBody.ambiguous, true);
    assert.deepEqual(
      ambiguousBody.matches.map((item) => item.patientId).sort(),
      [firstId, secondId].sort(),
    );

    const firstExact = await getPatients(db, cookie, `patientId=${firstId}`);
    const secondExact = await getPatients(db, cookie, `patientId=${secondId}`);
    assert.equal(firstExact.status, 200);
    assert.equal(secondExact.status, 200);
    const firstCard = await firstExact.json();
    const secondCard = await secondExact.json();
    assert.deepEqual(firstCard.bookings.map((row) => row.code), ["RD-SHARED-ONE"]);
    assert.deepEqual(secondCard.bookings.map((row) => row.code), ["RD-SHARED-TWO"]);
  });
});

test("creating another patient with the same phone never overwrites the existing profile", async () => {
  await withD1(async (db, raw) => {
    const cookie = await seedStaffSession(db, {
      email:"shared-create@example.com",
      role:"registrar",
      organizationId:1,
    });

    const firstResponse = await putPatient(db, cookie, {
      phone:`+${PHONE}`,
      displayName:"First Person",
      birthDate:"1985-04-05",
      notes:"keep me",
    });
    const first = await firstResponse.json();
    const secondResponse = await putPatient(db, cookie, {
      phone:`+${PHONE}`,
      displayName:"Second Person",
      birthDate:"1995-06-07",
    });
    const second = await secondResponse.json();

    assert.notEqual(first.profile.patientId, second.profile.patientId);
    const rows = raw.prepare(
      `SELECT patient_id AS patientId, display_name AS displayName, notes
       FROM patient_profiles WHERE organization_id = 1 AND phone_normalized = ?
       ORDER BY display_name`,
    ).all(PHONE);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.displayName), ["First Person", "Second Person"]);
    assert.equal(rows.find((row) => row.patientId === first.profile.patientId).notes, "keep me");
  });
});
