import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function setMembershipRole(db, email, role, organizationId = 1) {
  await db.prepare(
    "UPDATE memberships SET role = ?, active = 1 WHERE organization_id = ? AND member_email = ?"
  ).bind(role, organizationId, email).run();
}

async function getProfile(db, cookie) {
  return callWorker(
    jsonRequest("/api/staff/profile", undefined, { method:"GET", headers:{ cookie } }),
    db,
  );
}

test("self-profile returns the active tenant membership role, not the legacy global identity role", async () => {
  await withD1(async (db) => {
    const cases = [
      { email:"profile-system@example.com", role:"organization_admin" },
      { email:"profile-head@example.com", role:"department_head" },
      { email:"profile-rad@example.com", role:"radiologist" },
    ];

    for (const item of cases) {
      const cookie = await seedStaffSession(db, { email:item.email, role:"admin", displayName:"Profile User" });
      await setMembershipRole(db, item.email, item.role);

      const response = await getProfile(db, cookie);
      assert.equal(response.status, 200, `${item.role} must be able to read their own profile`);
      const body = await response.json();
      assert.equal(body.profile.email, item.email);
      assert.equal(body.profile.role, item.role);

      const identity = await db.prepare("SELECT role FROM staff_members WHERE email = ?").bind(item.email).first();
      assert.equal(identity.role, "admin", "test keeps legacy global identity role different from membership role");
    }
  });
});

test("system and management roles can update only their own shared profile through the neutral context", async () => {
  await withD1(async (db) => {
    const email = "profile-update@example.com";
    const cookie = await seedStaffSession(db, { email, role:"admin", displayName:"Before" });
    await setMembershipRole(db, email, "organization_admin");
    // Phone is the primary login identifier. Keep it unchanged in this ordinary
    // profile-edit regression; rebinding it is a separate security operation that
    // requires the current PIN and revokes sessions.
    await db.prepare("UPDATE staff_members SET phone = ? WHERE email = ?")
      .bind("380501234567", email).run();

    const response = await callWorker(
      jsonRequest("/api/staff/profile", {
        lastName:"Системний",
        firstName:"Адміністратор",
        patronymic:"Тестович",
        phone:"+380501234567",
        contactEmail:"self@example.com",
        militaryRank:"",
        positionTitle:"Системний адміністратор",
      }, { method:"PATCH", headers:{ cookie } }),
      db,
    );
    assert.equal(response.status, 200);

    const stored = await db.prepare(
      `SELECT display_name AS displayName, phone, contact_email AS contactEmail,
        position_title AS positionTitle, role
       FROM staff_members WHERE email = ?`
    ).bind(email).first();
    assert.equal(stored.displayName, "Системний Адміністратор Тестович");
    assert.equal(stored.phone, "380501234567");
    assert.equal(stored.contactEmail, "self@example.com");
    assert.equal(stored.positionTitle, "Системний адміністратор");
    assert.equal(stored.role, "admin", "self-service must never rewrite the legacy global authorization role");

    const after = await getProfile(db, cookie);
    assert.equal(after.status, 200);
    const body = await after.json();
    assert.equal(body.profile.role, "organization_admin");

    const audit = await db.prepare(
      `SELECT organization_id AS organizationId, action, details_json AS detailsJson
       FROM security_audit_log WHERE actor_email = ? AND action='profile_update'
       ORDER BY id DESC LIMIT 1`
    ).bind(email).first();
    assert.equal(audit.organizationId, 1);
    assert.equal(audit.action, "profile_update");
    assert.doesNotMatch(String(audit.detailsJson), /Системний|self@example|380501234567/);
  });
});

test("profile route uses the neutral membership context and never trusts staff_members.role for the response", async () => {
  const { readFile } = await import("node:fs/promises");
  const route = await readFile(new URL("../app/api/staff/profile/route.ts", import.meta.url), "utf8");
  const tenant = await readFile(new URL("../lib/tenant.ts", import.meta.url), "utf8");

  assert.match(route, /requireSelfServiceOrgContext\(request, db\)/);
  assert.match(route, /profile: \{ \.\.\.profile, role: ctx\.role \}/);
  assert.doesNotMatch(route, /position_title AS positionTitle,[\s\S]*role, active/);
  assert.match(tenant, /SELF_SERVICE_ROLES/);
  assert.match(tenant, /requireSelfServiceOrgContext/);
  assert.match(tenant, /resolveOrgContext\(request, db, SELF_SERVICE_ROLES\)/);
});
