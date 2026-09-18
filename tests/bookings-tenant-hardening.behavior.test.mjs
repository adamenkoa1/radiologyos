import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const routeSource = () => readFile(new URL("../app/api/staff/bookings/route.ts", import.meta.url), "utf8");

async function addOrganization(db, id, slug) {
  await db.prepare(
    "INSERT INTO organizations (id, slug, name, active) VALUES (?, ?, ?, 1)"
  ).bind(id, slug, `Organization ${id}`).run();
}

async function addBooking(db, organizationId, code) {
  const result = await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, service, service_code, equipment_id,
       duration_minutes, desired_date, desired_time, patient_category, status)
     VALUES (?, ?, 'Patient', '+380501112233', 'CT', '403', 'ct', 30,
       '2026-09-01', '10:00', 'civilian', 'confirmed')`
  ).bind(organizationId, code).run();
  return Number(result.meta.last_row_id);
}

test("booking staff roster and assignments use active membership roles in the current tenant", async () => {
  await withD1(async (db) => {
    await addOrganization(db, 2, "other-clinic");
    const adminCookie = await seedStaffSession(db, {
      email: "booking-admin@example.com", role: "admin", organizationId: 1,
    });

    // Global identity says radiographer, but the authoritative org membership says radiologist.
    await seedStaffSession(db, {
      email: "tenant-rad@example.com", role: "radiographer", organizationId: 1,
    });
    await db.prepare(
      "UPDATE memberships SET role = 'radiologist' WHERE organization_id = 1 AND member_email = ?"
    ).bind("tenant-rad@example.com").run();

    await seedStaffSession(db, {
      email: "foreign-rad@example.com", role: "radiologist", organizationId: 2,
    });
    const bookingId = await addBooking(db, 1, "TENANT-ASSIGN-1");

    const list = await callWorker(jsonRequest("/api/staff/bookings", undefined, {
      method: "GET", headers: { cookie: adminCookie },
    }), db);
    assert.equal(list.status, 200);
    const listBody = await list.json();
    const tenantRad = listBody.staffOptions.find((row) => row.email === "tenant-rad@example.com");
    assert.equal(tenantRad.role, "radiologist");
    assert.equal(listBody.staffOptions.some((row) => row.email === "foreign-rad@example.com"), false);

    const foreign = await callWorker(jsonRequest("/api/staff/bookings", {
      id: bookingId,
      assignedRadiologistEmail: "foreign-rad@example.com",
      assignedRadiographerEmail: "",
    }, { method: "PATCH", headers: { cookie: adminCookie } }), db);
    assert.equal(foreign.status, 400);

    const own = await callWorker(jsonRequest("/api/staff/bookings", {
      id: bookingId,
      assignedRadiologistEmail: "tenant-rad@example.com",
      assignedRadiographerEmail: "",
    }, { method: "PATCH", headers: { cookie: adminCookie } }), db);
    assert.equal(own.status, 200);

    const booking = await db.prepare(
      "SELECT assigned_radiologist_email AS radiologist FROM bookings WHERE organization_id = 1 AND id = ?"
    ).bind(bookingId).first();
    assert.equal(booking.radiologist, "tenant-rad@example.com");
    const event = await db.prepare(
      `SELECT organization_id AS organizationId FROM booking_events
       WHERE booking_id = ? AND action = 'staff_assigned' ORDER BY id DESC LIMIT 1`
    ).bind(bookingId).first();
    assert.equal(event.organizationId, 1);
  });
});

test("booking staff route keeps sensitive writes and audit reads explicitly tenant-scoped", async () => {
  const src = await routeSource();
  assert.match(src, /FROM memberships m[\s\S]*WHERE m\.organization_id = \? AND m\.active = 1 AND s\.active = 1/);
  assert.match(src, /m\.organization_id = \? AND m\.member_email = \? AND m\.role = \?/);
  assert.match(src, /assigned_radiographer_email = \?[\s\S]*WHERE organization_id = \? AND id = \?/);
  assert.match(src, /execution_recorded[\s\S]*organization_id/);
  assert.match(src, /protocol_status AS protocolStatus FROM bookings WHERE organization_id = \? AND id = \?/);
  assert.match(src, /military_verified_by[\s\S]*WHERE organization_id = \? AND id = \?/);
  for (const action of ["staff_note", "staff_assigned", "execution_recorded", "protocol_updated", "finance_updated"]) {
    const escaped = action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(src, new RegExp(`INSERT INTO booking_events \\(organization_id, booking_id, action, details, actor\\)[\\s\\S]*?'${escaped}'`));
  }
});
