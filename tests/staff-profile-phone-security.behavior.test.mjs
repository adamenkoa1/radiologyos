import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const TEST_PASSWORD_HASH = "pbkdf2$sha256$100000$bWVtYmVyc2hpcC10ZXN0IQ==$2/9vE4JQ+7or+3sxZDWVYBEZFHg+JGSjVqOivgvaoPs=";
const TEST_PIN = "123456";

async function seedProfileIdentity(db, {
  email = "profile-phone@phone.local",
  phone = "380501112233",
} = {}) {
  const cookie = await seedStaffSession(db, {
    email,
    role: "radiologist",
    organizationId: 1,
  });
  await db.prepare(
    "UPDATE staff_members SET phone = ?, password_hash = ? WHERE email = ?",
  ).bind(phone, TEST_PASSWORD_HASH, email).run();
  return { cookie, email, phone };
}

function profilePatch(body, cookie) {
  return jsonRequest("/api/staff/profile", body, {
    method: "PATCH",
    headers: { cookie },
  });
}

test("changing the staff login phone requires the current PIN before mutating identity", async () => {
  await withD1(async (db) => {
    const { cookie, email, phone: oldPhone } = await seedProfileIdentity(db);
    const newPhone = "380501112244";

    const denied = await callWorker(profilePatch({ phone: newPhone }, cookie), db);
    assert.equal(denied.status, 401);

    const afterDenied = await db.prepare(
      "SELECT phone FROM staff_members WHERE email = ?",
    ).bind(email).first();
    assert.equal(afterDenied.phone, oldPhone);

    const sessionsAfterDenied = await db.prepare(
      "SELECT COUNT(*) AS n FROM staff_sessions WHERE email = ?",
    ).bind(email).first();
    assert.equal(sessionsAfterDenied.n, 1);

    const allowed = await callWorker(profilePatch({ phone: newPhone, currentPin: TEST_PIN }, cookie), db);
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { ok: true, signedOut: true });

    const afterAllowed = await db.prepare(
      "SELECT phone FROM staff_members WHERE email = ?",
    ).bind(email).first();
    assert.equal(afterAllowed.phone, newPhone);

    const sessionsAfterAllowed = await db.prepare(
      "SELECT COUNT(*) AS n FROM staff_sessions WHERE email = ?",
    ).bind(email).first();
    assert.equal(sessionsAfterAllowed.n, 0);

    const securityAudit = await db.prepare(
      `SELECT organization_id AS organizationId, details_json AS detailsJson
       FROM security_audit_log
       WHERE actor_email = ? AND action = 'profile_security_update'
       ORDER BY id DESC LIMIT 1`,
    ).bind(email).first();
    assert.equal(securityAudit.organizationId, 1);
    assert.deepEqual(JSON.parse(securityAudit.detailsJson), {
      phoneChanged: true,
      pinChanged: false,
    });
  });
});

test("saving the unchanged login phone does not require PIN or revoke the session", async () => {
  await withD1(async (db) => {
    const { cookie, email, phone } = await seedProfileIdentity(db, {
      email: "profile-same-phone@phone.local",
      phone: "380501112255",
    });

    const response = await callWorker(profilePatch({ phone, firstName: "Марія" }, cookie), db);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, signedOut: false });

    const row = await db.prepare(
      "SELECT phone, first_name AS firstName FROM staff_members WHERE email = ?",
    ).bind(email).first();
    assert.equal(row.phone, phone);
    assert.equal(row.firstName, "Марія");

    const sessions = await db.prepare(
      "SELECT COUNT(*) AS n FROM staff_sessions WHERE email = ?",
    ).bind(email).first();
    assert.equal(sessions.n, 1);
  });
});