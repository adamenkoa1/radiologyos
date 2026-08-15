import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function seedProjectedBooking(db, id, radiologist, radiographer) {
  await db.prepare(
    `INSERT INTO bookings (
      id, organization_id, code, name, phone, phone_normalized, patient_email,
      service, service_code, equipment_id, duration_minutes, desired_date, desired_time,
      status, date_of_birth, patient_category, marketing_source,
      assigned_radiologist_email, assigned_radiographer_email,
      payment_status, payment_amount, paid_amount, payment_method, nszu_status, nszu_reference,
      protocol_status, external_reference
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    id, 1, `RD-PROJ${id}`, "Projection Patient", "+380971119999", "380971119999",
    "private.patient@example.test", "КТ", "CT-01", "ct", 30, "2026-09-03", "12:00",
    "confirmed", "1990-01-01", "civilian", "campaign-private",
    radiologist, radiographer, "paid", 98765, 98765, "cash", "confirmed", "NSZU-PRIVATE-001",
    "not_started", "CLINICAL-REF-001",
  ).run();

  for (const [action, details] of [
    ["status_changed", "confirmed"],
    ["finance_updated", "paid 98765 cash"],
  ]) {
    await db.prepare(
      `INSERT INTO booking_events (organization_id, booking_id, action, details, actor)
       VALUES (1, ?, ?, ?, 'finance@test')`,
    ).bind(id, action, details).run();
  }
  await db.prepare(
    `INSERT INTO patient_notifications
      (organization_id, booking_id, kind, channel, recipient, body, status, error, sent_at)
     VALUES (1, ?, 'custom', 'email', 'private.patient@example.test', 'Service message', 'sent', '', CURRENT_TIMESTAMP)`,
  ).bind(id).run();
}

const getBookings = (db, cookie) => callWorker(
  jsonRequest("/api/staff/bookings", undefined, { method:"GET", headers:{ cookie } }),
  db,
);

const sensitiveFields = [
  "phone", "patientEmail", "marketingSource", "paymentStatus", "paymentAmount",
  "paymentMethod", "nszuStatus", "nszuReference", "paidAmount", "listedPrice",
];

for (const roleCase of [
  { role:"radiologist", email:"projection-rad@example.test", assignment:"radiologist", id:931 },
  { role:"radiographer", email:"projection-tech@example.test", assignment:"radiographer", id:932 },
]) {
  test(`${roleCase.role} booking DTO omits patient contact and finance fields`, async () => {
    await withD1(async (db) => {
      const radiologist = roleCase.assignment === "radiologist" ? roleCase.email : "other-rad@example.test";
      const radiographer = roleCase.assignment === "radiographer" ? roleCase.email : "other-tech@example.test";
      await seedProjectedBooking(db, roleCase.id, radiologist, radiographer);
      const cookie = await seedStaffSession(db, { email:roleCase.email, role:roleCase.role });

      const response = await getBookings(db, cookie);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body.capabilities, {
        canManageBookings:false,
        canViewPatientContact:false,
        canManageFinance:false,
      });
      assert.equal(body.bookings.length, 1);
      const booking = body.bookings[0];
      for (const field of sensitiveFields) assert.equal(Object.hasOwn(booking, field), false, field);

      assert.equal(booking.name, "Projection Patient");
      assert.equal(booking.dateOfBirth, "1990-01-01");
      assert.equal(booking.service, "КТ");
      assert.equal(booking.protocolStatus, "not_started");
      assert.equal(booking.externalReference, "CLINICAL-REF-001");
      assert.equal(booking.assignedRadiologistEmail, radiologist);
      assert.equal(booking.assignedRadiographerEmail, radiographer);

      const serialized = JSON.stringify(booking);
      for (const privateValue of [
        "+380971119999", "private.patient@example.test", "campaign-private",
        "98765", "cash", "NSZU-PRIVATE-001",
      ]) assert.equal(serialized.includes(privateValue), false, privateValue);

      assert.deepEqual(body.events.map((event) => event.action), ["status_changed"]);
      assert.equal(body.notifications.length, 1);
      assert.equal(Object.hasOwn(body.notifications[0], "recipient"), false);
    });
  });
}

for (const role of ["registrar", "admin"]) {
  test(`${role} keeps booking contact and finance fields`, async () => {
    await withD1(async (db) => {
      const id = role === "registrar" ? 933 : 934;
      await seedProjectedBooking(db, id, "rad@example.test", "tech@example.test");
      const cookie = await seedStaffSession(db, { email:`projection-${role}@example.test`, role });

      const response = await getBookings(db, cookie);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body.capabilities, {
        canManageBookings:true,
        canViewPatientContact:true,
        canManageFinance:true,
      });
      const booking = body.bookings.find((item) => item.id === id);
      assert.equal(booking.phone, "+380971119999");
      assert.equal(booking.patientEmail, "private.patient@example.test");
      assert.equal(booking.marketingSource, "campaign-private");
      assert.equal(booking.paymentStatus, "paid");
      assert.equal(booking.paymentAmount, 98765);
      assert.equal(booking.paidAmount, 98765);
      assert.equal(booking.paymentMethod, "cash");
      assert.equal(booking.nszuStatus, "confirmed");
      assert.equal(booking.nszuReference, "NSZU-PRIVATE-001");
      assert.equal(booking.listedPrice, 98765);
      assert.equal(body.notifications[0].recipient, "private.patient@example.test");
    });
  });
}

test("staff overview gates contact and finance UI on server capabilities", async () => {
  const page = await readFile(new URL("../app/staff/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/staff/bookings/route.ts", import.meta.url), "utf8");
  const projection = await readFile(new URL("../lib/staff-booking-projection.ts", import.meta.url), "utf8");

  assert.match(route, /staffBookingCapabilities\(member\.role\)/);
  assert.match(route, /projectBookingForStaff\(booking, capabilities\)/);
  assert.match(route, /capabilities,/);
  assert.match(projection, /CONTACT_FIELDS/);
  assert.match(projection, /FINANCE_FIELDS/);
  assert.match(projection, /delete booking\[field\]/);

  assert.match(page, /const canViewPatientContact = capabilities\.canViewPatientContact/);
  assert.match(page, /const canFinance = capabilities\.canManageFinance/);
  assert.match(page, /\{canFinance && <label>Оплата/);
  assert.match(page, /\{canFinance && <span className=\{`paymentOverview/);
  assert.match(page, /\{canViewPatientContact && item\.phone && <>/);
  assert.match(page, /\{canFinance && <section>[\s\S]*<h3>Оплата та НСЗУ<\/h3>/);
  assert.equal(/Оплата та НСЗУ<\/h3>[\s\S]*: <dl className="operationReadOnly">/.test(page), false);
});
