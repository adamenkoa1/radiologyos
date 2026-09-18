import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

function todayInKyivForTest() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function setMembershipRole(db, email, role, organizationId = 1) {
  await db.prepare(
    "UPDATE memberships SET role = ?, active = 1 WHERE organization_id = ? AND member_email = ?"
  ).bind(role, organizationId, email).run();
}

async function seedBooking(db, { organizationId, code, name, phone, date, email = "" }) {
  const result = await db.prepare(
    `INSERT INTO bookings (
       organization_id, code, name, phone, phone_normalized, service, service_code,
       equipment_id, duration_minutes, desired_date, desired_time, referral,
       patient_category, referral_type
     ) VALUES (?, ?, ?, ?, ?, 'КТ органів грудної клітки', '408', 'ct', 30, ?, '09:00', 'test', 'civilian', 'other')`
  ).bind(organizationId, code, name, phone, phone, date).run();
  const id = Number(result.meta.last_row_id);
  await db.prepare(
    `UPDATE bookings
     SET performed_at = ?, payment_amount = 98765,
         assigned_radiologist_email = ?, assigned_radiographer_email = ?
     WHERE id = ?`
  ).bind(`${date}T09:30:00`, email, email, id).run();
  return id;
}

test("department_head receives tenant aggregate operations without patient or finance data", async () => {
  await withD1(async (db) => {
    const today = todayInKyivForTest();
    const email = "department-head@example.com";
    const cookie = await seedStaffSession(db, { email, role: "admin", displayName: "Завідувач" });
    await setMembershipRole(db, email, "department_head");

    const ownBookingId = await seedBooking(db, {
      organizationId: 1,
      code: "HEAD-OWN",
      name: "SECRET PATIENT ONE",
      phone: "380501112233",
      date: today,
      email,
    });

    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'other-org', 'Other Org', 1)").run();
    await seedBooking(db, {
      organizationId: 2,
      code: "HEAD-FOREIGN",
      name: "SECRET FOREIGN PATIENT",
      phone: "380509998877",
      date: today,
    });

    await db.prepare(
      `INSERT INTO equipment_maintenance
       (organization_id, equipment_id, event_type, status, title, downtime_start, created_by)
       VALUES (1, 'ct', 'fault', 'open', 'SECRET MAINTENANCE TITLE', ?, ?)`
    ).bind(today, email).run();

    const response = await callWorker(
      jsonRequest("/api/staff/management/summary", undefined, { method: "GET", headers: { cookie } }),
      db,
    );
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.staff.role, "department_head");
    assert.equal(body.organization.id, 1);
    assert.equal(body.summary.scheduledToday, 1, "foreign tenant booking must not be counted");
    assert.equal(body.summary.performedToday, 1);
    assert.equal(body.summary.awaitingProtocol, 1);
    assert.equal(body.summary.needImaging, 1);
    assert.equal(body.summary.activeMaintenance, 1);
    assert.equal(body.summary.openFaults, 1);
    assert.equal(body.summary.activeDowntime, 1);
    assert.ok(body.staffByRole.some((row) => row.role === "department_head" && Number(row.count) === 1));

    const serialized = JSON.stringify(body);
    for (const forbidden of [
      "SECRET PATIENT ONE",
      "SECRET FOREIGN PATIENT",
      "380501112233",
      "380509998877",
      "98765",
      "SECRET MAINTENANCE TITLE",
    ]) {
      assert.ok(!serialized.includes(forbidden), `management response must not expose ${forbidden}`);
    }

    const audit = await db.prepare(
      `SELECT details_json AS detailsJson FROM security_audit_log
       WHERE organization_id = 1 AND actor_email = ? AND action = 'management_summary_viewed'
       ORDER BY id DESC LIMIT 1`
    ).bind(email).first();
    assert.ok(audit, "management read should be security-audited");
    const auditText = String(audit.detailsJson || "");
    assert.ok(!auditText.includes("SECRET") && !auditText.includes("380501112233") && !auditText.includes("98765"));

    const denied = [
      `/api/staff/bookings`,
      `/api/staff/reports`,
      `/api/staff/settings`,
      `/api/staff/patients`,
      `/api/staff/protocols?bookingId=${ownBookingId}`,
      `/api/staff/imaging?bookingId=${ownBookingId}`,
    ];
    for (const path of denied) {
      const deniedResponse = await callWorker(
        jsonRequest(path, undefined, { method: "GET", headers: { cookie } }),
        db,
      );
      assert.equal(deniedResponse.status, 403, `${path} must remain outside department_head authority`);
    }
  });
});

test("management context admits legacy admin but rejects system-only administrator", async () => {
  await withD1(async (db) => {
    const legacyCookie = await seedStaffSession(db, { email: "legacy-admin@example.com", role: "admin" });
    const legacyResponse = await callWorker(
      jsonRequest("/api/staff/management/summary", undefined, { method: "GET", headers: { cookie: legacyCookie } }),
      db,
    );
    assert.equal(legacyResponse.status, 200);

    const systemEmail = "system-only@example.com";
    const systemCookie = await seedStaffSession(db, { email: systemEmail, role: "admin" });
    await setMembershipRole(db, systemEmail, "organization_admin");
    const systemResponse = await callWorker(
      jsonRequest("/api/staff/management/summary", undefined, { method: "GET", headers: { cookie: systemCookie } }),
      db,
    );
    assert.equal(systemResponse.status, 403);
  });
});

test("system administrator can assign department_head as membership-only authority", async () => {
  await withD1(async (db) => {
    const adminCookie = await seedStaffSession(db, { email: "system-admin@example.com", role: "admin" });
    const response = await callWorker(
      jsonRequest("/api/staff/members", {
        phone: "+380501234567",
        lastName: "Керівник",
        firstName: "Відділення",
        patronymic: "Тестович",
        positionTitle: "Завідувач відділення",
        role: "department_head",
        password: "123456",
      }, { headers: { cookie: adminCookie } }),
      db,
    );
    assert.equal(response.status, 201);

    const email = "380501234567@phone.local";
    const membership = await db.prepare(
      "SELECT role, active FROM memberships WHERE organization_id = 1 AND member_email = ?"
    ).bind(email).first();
    const identity = await db.prepare(
      "SELECT role FROM staff_members WHERE email = ?"
    ).bind(email).first();
    assert.equal(membership.role, "department_head");
    assert.equal(Number(membership.active), 1);
    assert.equal(identity.role, "admin", "global role remains legacy login/bootstrap compatibility only");
  });
});
