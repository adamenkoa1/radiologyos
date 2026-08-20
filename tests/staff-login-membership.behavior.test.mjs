import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const TEST_PASSWORD_HASH = "pbkdf2$sha256$100000$bWVtYmVyc2hpcC10ZXN0IQ==$2/9vE4JQ+7or+3sxZDWVYBEZFHg+JGSjVqOivgvaoPs=";

test("staff login refuses a valid PIN when no active tenant membership remains", async () => {
  await withD1(async (db) => {
    const phone = "380502225544";
    const email = `${phone}@phone.local`;
    await seedStaffSession(db, {
      email,
      role: "radiologist",
      displayName: "Деактивований Працівник",
      organizationId: 1,
    });
    await db.prepare(
      "UPDATE staff_members SET phone = ?, password_hash = ? WHERE email = ?",
    ).bind(phone, TEST_PASSWORD_HASH, email).run();
    await db.prepare("DELETE FROM staff_sessions WHERE email = ?").bind(email).run();
    await db.prepare(
      "UPDATE memberships SET active = 0 WHERE organization_id = 1 AND member_email = ?",
    ).bind(email).run();

    const denied = await callWorker(jsonRequest(
      "/api/staff/login",
      { phone: `+${phone}`, password: "123456" },
      { ip: "203.0.113.44" },
    ), db);
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get("set-cookie"), null);
    assert.equal((await denied.json()).error, "Невірний номер телефону або PIN-код");

    const disabledSessions = await db.prepare(
      "SELECT COUNT(*) AS n FROM staff_sessions WHERE email = ?",
    ).bind(email).first();
    assert.equal(disabledSessions.n, 0);

    await db.prepare(
      "UPDATE memberships SET active = 1 WHERE organization_id = 1 AND member_email = ?",
    ).bind(email).run();

    const allowed = await callWorker(jsonRequest(
      "/api/staff/login",
      { phone: `+${phone}`, password: "123456" },
      { ip: "203.0.113.45" },
    ), db);
    assert.equal(allowed.status, 200);
    assert.match(allowed.headers.get("set-cookie") || "", /rid_session=/);

    const activeSessions = await db.prepare(
      "SELECT COUNT(*) AS n FROM staff_sessions WHERE email = ?",
    ).bind(email).first();
    assert.equal(activeSessions.n, 1);
  });
});
