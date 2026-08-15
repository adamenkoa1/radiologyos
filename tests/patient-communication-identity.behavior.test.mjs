import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function patientPost(db, cookie, body) {
  return callWorker(
    jsonRequest("/api/staff/patients", body, { method: "POST", headers: { cookie } }),
    db,
  );
}

async function patientGet(db, cookie, patientId) {
  return callWorker(
    jsonRequest(`/api/staff/patients?patientId=${patientId}`, undefined, { method: "GET", headers: { cookie } }),
    db,
  );
}

test("exact patient communications are tenant-bound and never infer legacy phone history", async () => {
  await withD1(async (db, raw) => {
    await db.prepare(
      `INSERT INTO organizations (id, slug, name, active)
       VALUES (2, 'communication-test-org', 'Communication Test Org', 1)`
    ).run();

    const org1Cookie = await seedStaffSession(db, {
      email: "comm-org1@example.com",
      role: "registrar",
      organizationId: 1,
    });
    const org2Cookie = await seedStaffSession(db, {
      email: "comm-org2@example.com",
      role: "registrar",
      organizationId: 2,
    });

    await db.prepare(
      `INSERT INTO patient_profiles
        (organization_id, phone_normalized, display_name, updated_by)
       VALUES (1, '380501112233', 'Exact Contact', 'seed')`,
    ).run();
    await db.prepare(
      `INSERT INTO patient_profiles
        (organization_id, phone_normalized, display_name, updated_by)
       VALUES (2, '380671234567', 'Other Tenant Contact', 'seed')`,
    ).run();

    const patientId = raw.prepare(
      `SELECT patient_id AS patientId FROM patient_profiles
       WHERE organization_id = 1 AND phone_normalized = '380501112233'`,
    ).get().patientId;
    const otherTenantPatientId = raw.prepare(
      `SELECT patient_id AS patientId FROM patient_profiles
       WHERE organization_id = 2 AND phone_normalized = '380671234567'`,
    ).get().patientId;

    // Existing messaging/contact-center rows remain deliberately unlinked.
    await db.prepare(
      `INSERT INTO patient_communications
        (organization_id, phone_normalized, channel, direction, summary, actor)
       VALUES (1, '380501112233', 'call', 'inbound', 'legacy phone-only history', 'legacy')`,
    ).run();

    const before = await patientGet(db, org1Cookie, patientId);
    assert.equal(before.status, 200);
    const beforeBody = await before.json();
    assert.deepEqual(beforeBody.communications, [], "phone-only history must not be inferred into exact identity");

    const exactWrite = await patientPost(db, org1Cookie, {
      patientId,
      phone: "+380 99 999 99 99",
      channel: "call",
      direction: "outbound",
      summary: "exact identity note",
    });
    assert.equal(exactWrite.status, 200);
    const exactWriteBody = await exactWrite.json();
    assert.equal(exactWriteBody.communication.patientId, patientId);
    assert.equal(exactWriteBody.communication.phoneNormalized, "380501112233", "server must use profile contact, not spoofed body phone");

    const stored = raw.prepare(
      `SELECT patient_id AS patientId, phone_normalized AS phoneNormalized, summary
       FROM patient_communications WHERE summary = 'exact identity note'`,
    ).get();
    assert.equal(stored.patientId, patientId);
    assert.equal(stored.phoneNormalized, "380501112233");

    const exactRead = await patientGet(db, org1Cookie, patientId);
    assert.equal(exactRead.status, 200);
    const exactReadBody = await exactRead.json();
    assert.equal(exactReadBody.communications.length, 1);
    assert.equal(exactReadBody.communications[0].patientId, patientId);
    assert.equal(exactReadBody.communications[0].summary, "exact identity note");
    assert.equal(exactReadBody.legacyCommunicationsExcluded, true);

    const legacyWrite = await patientPost(db, org1Cookie, {
      phone: "+380 50 111 22 33",
      channel: "call",
      direction: "outbound",
      summary: "new legacy phone-only note",
    });
    assert.equal(legacyWrite.status, 200);
    const legacyStored = raw.prepare(
      `SELECT patient_id AS patientId FROM patient_communications
       WHERE summary = 'new legacy phone-only note'`,
    ).get();
    assert.equal(legacyStored.patientId, "");

    const crossTenantApi = await patientPost(db, org1Cookie, {
      patientId: otherTenantPatientId,
      phone: "+380 50 111 22 33",
      channel: "call",
      direction: "outbound",
      summary: "must not write",
    });
    assert.equal(crossTenantApi.status, 404);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM patient_communications WHERE summary = 'must not write'").get().n, 0);

    assert.throws(
      () => raw.prepare(
        `INSERT INTO patient_communications
          (organization_id, patient_id, phone_normalized, channel, direction, summary, actor)
         VALUES (1, ?, '380671234567', 'call', 'outbound', 'direct cross tenant', 'seed')`,
      ).run(otherTenantPatientId),
      /patient communication link invalid/i,
    );

    const otherTenantOwn = await patientPost(db, org2Cookie, {
      patientId: otherTenantPatientId,
      phone: "+380 00 000 00 00",
      channel: "call",
      direction: "outbound",
      summary: "other tenant own note",
    });
    assert.equal(otherTenantOwn.status, 200);
  });
});
