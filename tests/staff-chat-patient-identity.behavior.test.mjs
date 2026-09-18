import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const PHONE = "380971234567";
const OTHER_PHONE = "380991112233";
const PATIENT_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PATIENT_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PATIENT_OTHER_TENANT = "cccccccccccccccccccccccccccccccc";

async function seedProfile(db, organizationId, patientId, name, phone = PHONE) {
  await db.prepare(
    `INSERT INTO patient_profiles
      (patient_id, organization_id, phone_normalized, display_name, updated_by)
     VALUES (?, ?, ?, ?, 'seed@example.com')`
  ).bind(patientId, organizationId, phone, name).run();
}

async function seedCommunication(db, organizationId, patientId, phone, text) {
  await db.prepare(
    `INSERT INTO patient_communications
      (organization_id, patient_id, phone_normalized, channel, direction, summary, actor)
     VALUES (?, ?, ?, 'whatsapp', 'inbound', ?, 'system')`
  ).bind(organizationId, patientId, phone, text).run();
}

function staffGet(path, cookie) {
  return jsonRequest(path, undefined, { method:"GET", headers:{ cookie } });
}

function staffPost(path, cookie, body) {
  return jsonRequest(path, body, { method:"POST", headers:{ cookie } });
}

test("staff chat separates exact patients and legacy history that share one phone", async () => {
  await withD1(async (db) => {
    await seedProfile(db, 1, PATIENT_A, "Patient Alpha");
    await seedProfile(db, 1, PATIENT_B, "Patient Beta");
    await seedCommunication(db, 1, PATIENT_A, PHONE, "ALPHA_PRIVATE_MESSAGE");
    await seedCommunication(db, 1, PATIENT_B, PHONE, "BETA_PRIVATE_MESSAGE");
    await seedCommunication(db, 1, "", PHONE, "LEGACY_UNLINKED_MESSAGE");

    const cookie = await seedStaffSession(db, {
      email:"registrar@example.com", role:"registrar", displayName:"Registrar", organizationId:1,
    });

    const list = await callWorker(staffGet("/api/staff/chat", cookie), db);
    assert.equal(list.status, 200);
    const listBody = await list.json();
    assert.equal(listBody.conversations.length, 3);
    assert.deepEqual(
      new Set(listBody.conversations.map((row) => row.conversationKey)),
      new Set([`patient:${PATIENT_A}`, `patient:${PATIENT_B}`, `legacy:${PHONE}`]),
    );

    const alpha = await callWorker(staffGet(`/api/staff/chat?patientId=${PATIENT_A}`, cookie), db);
    assert.equal(alpha.status, 200);
    const alphaText = JSON.stringify(await alpha.json());
    assert.match(alphaText, /ALPHA_PRIVATE_MESSAGE/);
    assert.doesNotMatch(alphaText, /BETA_PRIVATE_MESSAGE|LEGACY_UNLINKED_MESSAGE/);

    const beta = await callWorker(staffGet(`/api/staff/chat?patientId=${PATIENT_B}`, cookie), db);
    assert.equal(beta.status, 200);
    const betaText = JSON.stringify(await beta.json());
    assert.match(betaText, /BETA_PRIVATE_MESSAGE/);
    assert.doesNotMatch(betaText, /ALPHA_PRIVATE_MESSAGE|LEGACY_UNLINKED_MESSAGE/);

    const legacy = await callWorker(staffGet(`/api/staff/chat?legacyPhone=${PHONE}`, cookie), db);
    assert.equal(legacy.status, 200);
    const legacyText = JSON.stringify(await legacy.json());
    assert.match(legacyText, /LEGACY_UNLINKED_MESSAGE/);
    assert.doesNotMatch(legacyText, /ALPHA_PRIVATE_MESSAGE|BETA_PRIVATE_MESSAGE/);
  });
});

test("phone-only staff chat fails closed when a shared contact has multiple identity scopes", async () => {
  await withD1(async (db) => {
    await seedProfile(db, 1, PATIENT_A, "Patient Alpha");
    await seedProfile(db, 1, PATIENT_B, "Patient Beta");
    await seedCommunication(db, 1, PATIENT_A, PHONE, "ALPHA_SECRET");
    await seedCommunication(db, 1, PATIENT_B, PHONE, "BETA_SECRET");
    await seedCommunication(db, 1, "", PHONE, "LEGACY_SECRET");

    const cookie = await seedStaffSession(db, { email:"registrar@example.com", role:"registrar", organizationId:1 });
    const response = await callWorker(staffGet(`/api/staff/chat?phone=${PHONE}`, cookie), db);
    assert.equal(response.status, 409);
    const text = await response.text();
    assert.doesNotMatch(text, /ALPHA_SECRET|BETA_SECRET|LEGACY_SECRET/);
  });
});

test("phone-only compatibility remains ambiguous across channel filters", async () => {
  await withD1(async (db) => {
    await seedProfile(db, 1, PATIENT_A, "Patient Alpha");
    await seedProfile(db, 1, PATIENT_B, "Patient Beta");
    await seedCommunication(db, 1, PATIENT_A, PHONE, "ALPHA_WHATSAPP_SECRET");
    await db.prepare(
      `INSERT INTO patient_communications
        (organization_id, patient_id, phone_normalized, channel, direction, summary, actor)
       VALUES (1, ?, ?, 'telegram', 'inbound', 'BETA_TELEGRAM_SECRET', 'system')`
    ).bind(PATIENT_B, PHONE).run();

    const cookie = await seedStaffSession(db, { email:"registrar@example.com", role:"registrar", organizationId:1 });
    const response = await callWorker(
      staffGet(`/api/staff/chat?phone=${PHONE}&channel=whatsapp`, cookie),
      db,
    );
    assert.equal(response.status, 409);
    const text = await response.text();
    assert.doesNotMatch(text, /ALPHA_WHATSAPP_SECRET|BETA_TELEGRAM_SECRET/);
  });
});

test("legacy reply fails closed when the phone belongs to an exact profile", async () => {
  await withD1(async (db) => {
    await seedProfile(db, 1, PATIENT_A, "Patient Alpha");
    await seedCommunication(db, 1, "", PHONE, "OLD_LEGACY_MESSAGE");
    const cookie = await seedStaffSession(db, { email:"registrar@example.com", role:"registrar", organizationId:1 });

    const response = await callWorker(staffPost("/api/staff/chat", cookie, {
      phone:PHONE, identityKind:"legacy", text:"Do not send", channel:"whatsapp",
    }), db);
    assert.equal(response.status, 409);

    const count = await db.prepare(
      `SELECT COUNT(*) AS count FROM patient_communications
       WHERE organization_id = 1 AND direction = 'outbound'`
    ).first();
    assert.equal(Number(count?.count || 0), 0);
  });
});

test("exact reply rejects a stale client phone before transport and exact lookup stays tenant-scoped", async () => {
  await withD1(async (db) => {
    await seedProfile(db, 1, PATIENT_A, "Patient Alpha", PHONE);
    await seedProfile(db, 2, PATIENT_OTHER_TENANT, "Other Tenant", OTHER_PHONE);
    await seedCommunication(db, 2, PATIENT_OTHER_TENANT, OTHER_PHONE, "OTHER_TENANT_SECRET");

    const cookie = await seedStaffSession(db, { email:"registrar@example.com", role:"registrar", organizationId:1 });

    const stale = await callWorker(staffPost("/api/staff/chat", cookie, {
      patientId:PATIENT_A, phone:OTHER_PHONE, text:"Do not send", channel:"whatsapp",
    }), db);
    assert.equal(stale.status, 409);

    // Supplying a same-tenant compatibility phone must never rescue a foreign exact patient ID.
    const crossTenant = await callWorker(
      staffGet(`/api/staff/chat?patientId=${PATIENT_OTHER_TENANT}&phone=${PHONE}`, cookie),
      db,
    );
    assert.equal(crossTenant.status, 404);
    assert.doesNotMatch(await crossTenant.text(), /OTHER_TENANT_SECRET/);
  });
});
