import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, seedStaffSession, withD1 } from "./helpers/d1.mjs";

function todayKyiv() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone:"Europe/Kyiv",
    year:"numeric",
    month:"2-digit",
    day:"2-digit",
  }).format(new Date());
}

test("staff dashboard excludes every other tenant from KPI and list output", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email:"dashboard-admin@test.local", role:"admin" });
    const today = todayKyiv();

    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'other-tenant', 'Other Tenant', 1)").run();

    await db.prepare(
      `INSERT INTO bookings
        (organization_id, code, name, phone, phone_normalized, service, service_code, desired_date, desired_time,
         status, patient_category, payment_status, payment_amount, performed_at, protocol_status, protocol_number)
       VALUES
        (1, 'ORG1-BOOKING', 'Org One Patient', '+380670000001', '+380670000001', 'КТ', '401', ?, '09:00',
         'new', 'civilian', 'not_set', 100, '', 'not_started', ''),
        (2, 'ORG2-SECRET-CODE', 'ORG2 SECRET PATIENT', '+380670000002', '+380670000002', 'КТ', '401', ?, '10:00',
         'new', 'civilian', 'not_set', 99999, datetime('now'), 'ready', 'ORG2-SECRET-PROTOCOL')`
    ).bind(today, today).run();

    await db.prepare(
      `INSERT INTO patient_profiles
        (organization_id, phone_normalized, display_name, do_not_contact, updated_by)
       VALUES
        (1, '+380670000001', 'Org One Patient', 0, 'dashboard-admin@test.local'),
        (2, '+380670000002', 'ORG2 SECRET PROFILE', 1, 'other-admin@test.local')`
    ).run();

    await db.prepare(
      `INSERT INTO imaging_studies
        (organization_id, booking_id, accession_number, study_instance_uid, modality, study_status, updated_by)
       SELECT 2, id, 'ORG2-SECRET-ACCESSION', '1.2.3.4.5.6.7.8.2', 'CT', 'available', 'other-admin@test.local'
       FROM bookings WHERE organization_id = 2 AND code = 'ORG2-SECRET-CODE'`
    ).run();

    await db.prepare("UPDATE pacs_settings SET enabled = 0 WHERE organization_id = 1").run();
    await db.prepare(
      `INSERT INTO pacs_settings
        (id, organization_id, dicomweb_base_url, enabled, updated_by)
       VALUES (2, 2, 'https://org2-secret-pacs.example.test', 1, 'other-admin@test.local')`
    ).run();

    const response = await callWorker(new Request("http://localhost/api/staff/dashboard", {
      headers:{ cookie },
    }), db);
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.kpi.scheduledToday, 1);
    assert.equal(body.kpi.newToday, 1);
    assert.equal(body.kpi.outstandingCount, 1);
    assert.equal(body.kpi.outstandingSum, 100);
    assert.equal(body.kpi.patients, 1);
    assert.equal(body.kpi.doNotContact, 0);
    assert.equal(body.kpi.availableStudies, 0);
    assert.equal(body.kpi.pacsEnabled, false);

    const serialized = JSON.stringify(body);
    for (const forbidden of [
      "ORG2-SECRET-CODE",
      "ORG2 SECRET PATIENT",
      "ORG2-SECRET-PROTOCOL",
      "ORG2 SECRET PROFILE",
      "ORG2-SECRET-ACCESSION",
      "org2-secret-pacs.example.test",
      "99999",
    ]) assert.equal(serialized.includes(forbidden), false, `dashboard leaked ${forbidden}`);
  });
});
