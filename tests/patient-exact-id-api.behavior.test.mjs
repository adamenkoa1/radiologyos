import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function patientPut(db, cookie, body) {
  return callWorker(
    jsonRequest("/api/staff/patients", body, { method: "PUT", headers: { cookie } }),
    db,
  );
}

async function patientGet(db, cookie, query) {
  return callWorker(
    jsonRequest(`/api/staff/patients?${query}`, undefined, { method: "GET", headers: { cookie } }),
    db,
  );
}

test("exact patient-id reads include only explicitly linked bookings and exclude phone-scoped communications", async () => {
  await withD1(async (db, raw) => {
    const cookie = await seedStaffSession(db, {
      email: "exact-registry@example.com",
      role: "registrar",
      displayName: "Exact Registry",
      organizationId: 1,
    });

    const createdResponse = await patientPut(db, cookie, {
      phone: "+380501112233",
      displayName: "Exact Patient",
      birthDate: "1980-01-10",
      email: "exact@example.com",
    });
    assert.equal(createdResponse.status, 200);
    const created = await createdResponse.json();
    const patientId = String(created.profile.patientId);
    assert.match(patientId, /^[0-9a-f]{32}$/);

    await db.prepare(
      `INSERT INTO bookings
        (organization_id, patient_id, code, name, phone, phone_normalized, date_of_birth,
         service, service_code, desired_date, desired_time)
       VALUES (1, ?, 'RD-EXACT-LINKED', 'Exact Patient', '+380501112233', '380501112233',
         '1980-01-10', 'КТ', '403', '2026-09-20', '10:00')`,
    ).bind(patientId).run();
    await db.prepare(
      `INSERT INTO bookings
        (organization_id, code, name, phone, phone_normalized, date_of_birth,
         service, service_code, desired_date, desired_time)
       VALUES (1, 'RD-EXACT-LEGACY', 'Same Phone Legacy', '+380501112233', '380501112233',
         '1980-01-10', 'КТ', '403', '2026-09-21', '10:00')`,
    ).run();
    await db.prepare(
      `INSERT INTO patient_communications
        (organization_id, phone_normalized, channel, direction, summary, actor)
       VALUES (1, '380501112233', 'call', 'outbound', 'legacy phone-scoped note', 'seed')`,
    ).run();

    const exactResponse = await patientGet(db, cookie, `patientId=${patientId}`);
    assert.equal(exactResponse.status, 200);
    const exact = await exactResponse.json();
    assert.equal(exact.patientId, patientId);
    assert.equal(exact.profile.patientId, patientId);
    assert.equal(exact.patient.patientId, patientId);
    assert.equal(exact.patient.visits, 1);
    assert.deepEqual(exact.bookings.map((row) => row.code), ["RD-EXACT-LINKED"]);
    assert.deepEqual(exact.communications, []);
    assert.equal(exact.legacyCommunicationsExcluded, true);

    const legacyResponse = await patientGet(db, cookie, "phone=380501112233");
    assert.equal(legacyResponse.status, 200);
    const legacy = await legacyResponse.json();
    assert.equal(legacy.bookings.length, 2, "legacy phone path remains compatible until CRM cutover");
    assert.equal(legacy.communications.length, 1);

    const listResponse = await patientGet(db, cookie, "");
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    const summary = list.patients.find((item) => item.phoneNormalized === "380501112233");
    assert.equal(summary.patientId, patientId, "legacy list exposes opaque id for future exact selection");

    const audit = raw.prepare(
      `SELECT target_id AS targetId FROM security_audit_log
       WHERE action = 'patient_record_viewed' ORDER BY id DESC LIMIT 1`,
    ).get();
    assert.equal(audit.targetId, patientId);
  });
});

test("exact patient-id update keeps identity stable even when contact phone changes", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, {
      email: "exact-update@example.com",
      role: "registrar",
      organizationId: 1,
    });

    const createdResponse = await patientPut(db, cookie, {
      phone: "+380501112233",
      displayName: "Before Update",
      birthDate: "1980-01-10",
    });
    const created = await createdResponse.json();
    const patientId = created.profile.patientId;

    await db.prepare(
      `INSERT INTO bookings
        (organization_id, patient_id, code, name, phone, phone_normalized,
         service, service_code, desired_date, desired_time)
       VALUES (1, ?, 'RD-CONTACT-SNAPSHOT', 'Before Update', '+380501112233', '380501112233',
         'КТ', '403', '2026-09-22', '10:00')`,
    ).bind(patientId).run();

    const updateResponse = await patientPut(db, cookie, {
      patientId,
      phone: "+380671234567",
      displayName: "After Update",
      birthDate: "1980-01-10",
      email: "after@example.com",
    });
    assert.equal(updateResponse.status, 200);
    const updated = await updateResponse.json();
    assert.equal(updated.profile.patientId, patientId);
    assert.equal(updated.profile.phoneNormalized, "380671234567");

    const exactResponse = await patientGet(db, cookie, `patientId=${patientId}`);
    assert.equal(exactResponse.status, 200);
    const exact = await exactResponse.json();
    assert.equal(exact.patient.phoneNormalized, "380671234567");
    assert.equal(exact.patient.visits, 1);
    assert.equal(exact.bookings[0].phoneNormalized, "380501112233", "booking keeps its historical contact snapshot");
  });
});

test.skip("exact patient-id access is tenant-scoped and invalid identifiers fail closed", async () => {
  await withD1(async (db, raw) => {
    const org1Cookie = await seedStaffSession(db, {
      email: "exact-org1@example.com",
      role: "registrar",
      organizationId: 1,
    });
    const org2Cookie = await seedStaffSession(db, {
      email: "exact-org2@example.com",
      role: "registrar",
      organizationId: 2,
    });

    await db.prepare(
      `INSERT INTO patient_profiles
        (organization_id, phone_normalized, display_name, updated_by)
       VALUES (2, '380931234567', 'Tenant Two Patient', 'seed')`,
    ).run();
    const patientId = raw.prepare(
      "SELECT patient_id AS patientId FROM patient_profiles WHERE organization_id = 2 AND phone_normalized = '380931234567'",
    ).get().patientId;

    const crossTenant = await patientGet(db, org1Cookie, `patientId=${patientId}`);
    assert.equal(crossTenant.status, 404);

    const ownTenant = await patientGet(db, org2Cookie, `patientId=${patientId}`);
    assert.equal(ownTenant.status, 200);

    const invalid = await patientGet(db, org1Cookie, "patientId=not-an-id");
    assert.equal(invalid.status, 400);

    const crossTenantUpdate = await patientPut(db, org1Cookie, {
      patientId,
      phone: "+380501234567",
      displayName: "Should Not Change",
    });
    assert.equal(crossTenantUpdate.status, 404);
    const unchanged = raw.prepare(
      "SELECT display_name AS displayName FROM patient_profiles WHERE organization_id = 2 AND patient_id = ?",
    ).get(patientId);
    assert.equal(unchanged.displayName, "Tenant Two Patient");
  });
});
