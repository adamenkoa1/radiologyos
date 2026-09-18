import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function seedBooking(db, { id, email }) {
  await db.prepare(
    `INSERT INTO bookings (
      id, organization_id, code, name, phone, phone_normalized, service, service_code,
      equipment_id, duration_minutes, desired_date, desired_time, status, date_of_birth,
      patient_category, assigned_radiologist_email, assigned_radiographer_email
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, 1, `RD-SYS${id}`, "System Admin Must Not See Me", "+380971118888", "380971118888",
    "КТ", "CT-01", "ct", 30, "2026-09-05", "09:00", "confirmed", "1990-01-01",
    "civilian", email, email,
  ).run();
}

function get(db, cookie, path) {
  return callWorker(jsonRequest(path, undefined, { method:"GET", headers:{ cookie } }), db);
}

test("organization_admin has control-plane access but no medical-data context", async () => {
  await withD1(async (db) => {
    const email = "system-admin@likarnya.test";
    await seedBooking(db, { id:971, email });

    // Global identity stays legacy-compatible; tenant membership is authoritative.
    const cookie = await seedStaffSession(db, { email, role:"admin", organizationId:1 });
    await db.prepare(
      "UPDATE memberships SET role='organization_admin' WHERE organization_id=1 AND member_email=?",
    ).bind(email).run();

    for (const path of [
      "/api/staff/members",
      "/api/staff/system/health",
      "/api/staff/imaging/settings",
      "/api/staff/integrations/health",
      "/api/staff/integrations/mwl-token",
      "/api/staff/settings",
    ]) {
      const response = await get(db, cookie, path);
      assert.equal(response.status, 200, `${path} should be available to system admin`);
    }

    // Medical/operational routes use requireOrgContext, which deliberately does
    // not admit organization_admin. Assignment must not change that boundary.
    for (const path of [
      "/api/staff/bookings",
      "/api/staff/search?q=System%20Admin",
      "/api/staff/protocols?bookingId=971",
      "/api/staff/imaging?bookingId=971",
      "/api/staff/patients?phone=380971118888",
    ]) {
      const response = await get(db, cookie, path);
      assert.equal(response.status, 403, `${path} must deny system admin medical access`);
      assert.doesNotMatch(await response.text(), /System Admin Must Not See Me|380971118888/);
    }

    const contextResponse = await get(db, cookie, "/api/staff/study-context?id=971");
    assert.equal(contextResponse.status, 404);
    assert.doesNotMatch(await contextResponse.text(), /System Admin Must Not See Me|380971118888/);
  });
});

test("staff management stores organization_admin as membership authority only", async () => {
  await withD1(async (db) => {
    const adminCookie = await seedStaffSession(db, {
      email:"legacy-admin@likarnya.test",
      role:"admin",
      organizationId:1,
    });

    const response = await callWorker(jsonRequest("/api/staff/members", {
      phone:"+380971234567",
      lastName:"Системний",
      firstName:"Адміністратор",
      positionTitle:"Системний адміністратор",
      role:"organization_admin",
      active:true,
      password:"123456",
    }, { method:"POST", headers:{ cookie:adminCookie } }), db);
    assert.equal(response.status, 201);

    const email = "380971234567@phone.local";
    const identity = await db.prepare(
      "SELECT role FROM staff_members WHERE email=? LIMIT 1",
    ).bind(email).first();
    const membership = await db.prepare(
      "SELECT role, active FROM memberships WHERE organization_id=1 AND member_email=? LIMIT 1",
    ).bind(email).first();

    assert.equal(identity?.role, "admin", "global identity remains legacy-compatible");
    assert.equal(membership?.role, "organization_admin", "tenant membership owns system authority");
    assert.equal(Number(membership?.active), 1);
  });
});
