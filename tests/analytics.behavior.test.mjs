import assert from "node:assert/strict";
import test from "node:test";
import { recordAnalyticsEvent } from "../lib/analytics.ts";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

test("public analytics accepts only anonymous allowlisted funnel fields", async () => {
  await withD1(async (db) => {
    const valid = await callWorker(jsonRequest("/api/analytics", {
      eventName: "service_view",
      journeyId: "journey_12345678",
      serviceCode: "401",
      patientCategory: "civilian",
      pageKey: "/ct/head/",
    }), db);
    assert.equal(valid.status, 204);

    const row = await db.prepare(
      "SELECT event_name AS eventName, journey_id AS journeyId, service_code AS serviceCode FROM analytics_events LIMIT 1",
    ).first();
    assert.equal(row.eventName, "service_view");
    assert.equal(row.journeyId, "journey_12345678");
    assert.equal(row.serviceCode, "401");

    for (const extra of [
      { phone: "+380501112233" },
      { name: "Пацієнт" },
      { dob: "1990-01-01" },
      { notes: "clinical text" },
      { bookingId: 123 },
    ]) {
      const rejected = await callWorker(jsonRequest("/api/analytics", {
        eventName: "page_view",
        journeyId: "journey_abcdefgh",
        ...extra,
      }), db);
      assert.equal(rejected.status, 400);
    }
  });
});

test("analytics event allowlist rejects fabricated server milestones from the browser", async () => {
  await withD1(async (db) => {
    for (const eventName of ["booking_created", "payment_started", "payment_completed", "patient_arrived", "study_completed", "made_up_event"]) {
      const response = await callWorker(jsonRequest("/api/analytics", {
        eventName,
        journeyId: "journey_abcdefgh",
      }), db);
      assert.equal(response.status, 400);
    }
  });
});

test("analytics storage failure never throws into core workflows", async () => {
  const brokenDb = {
    prepare() { throw new Error("analytics unavailable"); },
  };
  const recorded = await recordAnalyticsEvent(brokenDb, {
    eventName: "booking_created",
    organizationId: 1,
    serviceCode: "401",
    patientCategory: "civilian",
  });
  assert.equal(recorded, false);
  assert.equal(await recordAnalyticsEvent(null, { eventName: "page_view" }), false);
});

test("analytics ledger schema contains no direct patient identifiers or arbitrary metadata", async () => {
  await withD1(async (db) => {
    const { results } = await db.prepare("PRAGMA table_info(analytics_events)").all();
    const columns = results.map((row) => row.name);
    assert.deepEqual(columns, [
      "id", "organization_id", "event_name", "journey_id", "service_code",
      "patient_category", "page_key", "source", "occurred_at",
    ]);
    for (const forbidden of ["name", "phone", "dob", "date_of_birth", "booking_id", "ip", "user_agent", "metadata", "notes"]) {
      assert.equal(columns.includes(forbidden), false);
    }
  });
});

test("staff funnel report is tenant-scoped and derives clinical milestones from operational audit", async () => {
  await withD1(async (db) => {
    await db.prepare(
      `INSERT INTO analytics_events
       (organization_id, event_name, journey_id, service_code, patient_category, page_key, source)
       VALUES (1, 'page_view', 'journey_one', '401', 'civilian', '/ct/head/', 'client'),
              (1, 'booking_created', 'journey_one', '401', 'civilian', '', 'server'),
              (2, 'page_view', 'journey_other', '401', 'civilian', '/ct/head/', 'client')`,
    ).run();

    const booking = await db.prepare(
      `INSERT INTO bookings (
        organization_id, code, name, phone, phone_normalized, service, service_code,
        equipment_id, duration_minutes, desired_date, desired_time, patient_category,
        payment_status, payment_amount, status
      ) VALUES (1, 'RD-AN-1', 'Synthetic', '+380501112233', '380501112233', 'КТ ГМ', '401',
        'ct', 30, '2026-08-20', '11:30', 'civilian', 'paid', 1500, 'completed')`,
    ).run();
    const bookingId = Number(booking.meta.last_row_id);
    await db.prepare(
      `INSERT INTO booking_events (organization_id, booking_id, action, details, actor, created_at)
       VALUES (1, ?, 'status_changed', 'arrived', 'test', '2026-08-20 10:00:00'),
              (1, ?, 'status_changed', 'completed', 'test', '2026-08-20 10:30:00')`,
    ).bind(bookingId, bookingId).run();

    const cookie = await seedStaffSession(db, { email: "admin@example.com", role: "admin", organizationId: 1 });
    const response = await callWorker(new Request(
      "https://radiologyos.test/api/staff/analytics?from=2026-08-01&to=2026-08-31",
      { headers: { cookie } },
    ), db);
    assert.equal(response.status, 200);
    const body = await response.json();
    const byEvent = Object.fromEntries(body.funnel.map((row) => [row.eventName, row]));
    assert.equal(byEvent.page_view.events, 1);
    assert.equal(byEvent.booking_created.events, 1);
    assert.equal(byEvent.patient_arrived.events, 1);
    assert.equal(byEvent.study_completed.events, 1);
  });
});
