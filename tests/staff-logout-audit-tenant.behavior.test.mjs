import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function addOrganizationTwo(db) {
  await db.prepare(
    "INSERT INTO organizations (id, slug, name, active) VALUES (2, 'logout-audit-two', 'Logout Audit Two', 1)",
  ).run();
}

function logoutRequest(cookie) {
  return new Request("http://localhost/api/staff/logout", {
    method: "POST",
    headers: { cookie },
  });
}

test("org2-only staff logout audit stays out of org1 and destroys the session", async () => {
  await withD1(async (db) => {
    await addOrganizationTwo(db);
    const email = "logout-org2@phone.local";
    const cookie = await seedStaffSession(db, {
      email,
      role: "radiologist",
      organizationId: 2,
    });

    const response = await callWorker(logoutRequest(cookie), db);
    assert.equal(response.status, 200);

    const rows = await db.prepare(
      `SELECT organization_id AS organizationId
       FROM security_audit_log
       WHERE actor_email = ? AND action = 'logout'
       ORDER BY organization_id`,
    ).bind(email).all();
    assert.deepEqual(rows.results.map((row) => row.organizationId), [2]);

    const sessions = await db.prepare(
      "SELECT COUNT(*) AS n FROM staff_sessions WHERE email = ?",
    ).bind(email).first();
    assert.equal(sessions.n, 0);
  });
});

test("multi-org identity logout is audited to every active tenant membership", async () => {
  await withD1(async (db) => {
    await addOrganizationTwo(db);
    const email = "logout-multi@phone.local";
    const cookie = await seedStaffSession(db, {
      email,
      role: "radiologist",
      organizationId: 1,
    });
    await db.prepare(
      "INSERT INTO memberships (organization_id, member_email, role, active) VALUES (2, ?, 'radiologist', 1)",
    ).bind(email).run();

    const response = await callWorker(logoutRequest(cookie), db);
    assert.equal(response.status, 200);

    const rows = await db.prepare(
      `SELECT organization_id AS organizationId
       FROM security_audit_log
       WHERE actor_email = ? AND action = 'logout'
       ORDER BY organization_id`,
    ).bind(email).all();
    assert.deepEqual(rows.results.map((row) => row.organizationId), [1, 2]);
  });
});