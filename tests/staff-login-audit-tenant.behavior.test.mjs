import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const TEST_PASSWORD_HASH = "pbkdf2$sha256$100000$bWVtYmVyc2hpcC10ZXN0IQ==$2/9vE4JQ+7or+3sxZDWVYBEZFHg+JGSjVqOivgvaoPs=";

async function addOrganizationTwo(db) {
  await db.prepare(
    "INSERT INTO organizations (id, slug, name, active) VALUES (2, 'login-audit-two', 'Login Audit Two', 1)",
  ).run();
}

async function seedLoginIdentity(db, { phone, organizationId = 2 }) {
  const email = `${phone}@phone.local`;
  await seedStaffSession(db, {
    email,
    role: "radiologist",
    displayName: "Аудит Працівник",
    organizationId,
  });
  await db.prepare(
    "UPDATE staff_members SET phone = ?, password_hash = ? WHERE email = ?",
  ).bind(phone, TEST_PASSWORD_HASH, email).run();
  await db.prepare("DELETE FROM staff_sessions WHERE email = ?").bind(email).run();
  return email;
}

test("org2 staff login success and failure audit only to org2", async () => {
  await withD1(async (db) => {
    await addOrganizationTwo(db);
    const phone = "380502225533";
    const email = await seedLoginIdentity(db, { phone });

    const failed = await callWorker(jsonRequest(
      "/api/staff/login",
      { phone: `+${phone}`, password: "654321" },
      { ip: "203.0.113.53" },
    ), db);
    assert.equal(failed.status, 401);

    const failedRows = await db.prepare(
      `SELECT organization_id AS organizationId
       FROM security_audit_log
       WHERE actor_email = ? AND action = 'login_failed'
       ORDER BY organization_id`,
    ).bind(email).all();
    assert.deepEqual(failedRows.results.map((row) => row.organizationId), [2]);

    const success = await callWorker(jsonRequest(
      "/api/staff/login",
      { phone: `+${phone}`, password: "123456" },
      { ip: "203.0.113.54" },
    ), db);
    assert.equal(success.status, 200);

    const successRows = await db.prepare(
      `SELECT organization_id AS organizationId
       FROM security_audit_log
       WHERE actor_email = ? AND action = 'login'
       ORDER BY organization_id`,
    ).bind(email).all();
    assert.deepEqual(successRows.results.map((row) => row.organizationId), [2]);

    const leakedToOrg1 = await db.prepare(
      "SELECT COUNT(*) AS n FROM security_audit_log WHERE organization_id = 1 AND actor_email = ? AND resource = 'auth'",
    ).bind(email).first();
    assert.equal(leakedToOrg1.n, 0);
  });
});

test("multi-org identity login is visible to every active organization it can enter", async () => {
  await withD1(async (db) => {
    await addOrganizationTwo(db);
    const phone = "380502225532";
    const email = await seedLoginIdentity(db, { phone, organizationId: 1 });
    await db.prepare(
      "INSERT INTO memberships (organization_id, member_email, role, active) VALUES (2, ?, 'radiologist', 1)",
    ).bind(email).run();

    const success = await callWorker(jsonRequest(
      "/api/staff/login",
      { phone: `+${phone}`, password: "123456" },
      { ip: "203.0.113.55" },
    ), db);
    assert.equal(success.status, 200);

    const rows = await db.prepare(
      `SELECT organization_id AS organizationId
       FROM security_audit_log
       WHERE actor_email = ? AND action = 'login'
       ORDER BY organization_id`,
    ).bind(email).all();
    assert.deepEqual(rows.results.map((row) => row.organizationId), [1, 2]);
  });
});

test("unknown login guess is not attributed to an arbitrary tenant in multi-org mode", async () => {
  await withD1(async (db) => {
    await addOrganizationTwo(db);
    const phone = "380502225531";

    const failed = await callWorker(jsonRequest(
      "/api/staff/login",
      { phone: `+${phone}`, password: "123456" },
      { ip: "203.0.113.56" },
    ), db);
    assert.equal(failed.status, 401);

    const rows = await db.prepare(
      "SELECT organization_id AS organizationId FROM security_audit_log WHERE actor_email = ? AND action = 'login_failed'",
    ).bind(phone).all();
    assert.deepEqual(rows.results, []);
  });
});
