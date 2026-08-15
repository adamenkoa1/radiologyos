import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

function nextBookableDate() {
  const now = new Date();
  const kyiv = new Intl.DateTimeFormat("en-CA", {
    timeZone:"Europe/Kyiv", year:"numeric", month:"2-digit", day:"2-digit",
  }).format(now);
  const d = new Date(`${kyiv}T12:00:00Z`);
  for (let i = 0; i < 7; i += 1) {
    const candidate = new Date(d);
    candidate.setUTCDate(d.getUTCDate() + i);
    if (candidate.getUTCDay() !== 0) return candidate.toISOString().slice(0, 10);
  }
  throw new Error("no bookable day");
}

async function createPatient(db, cookie, body) {
  const response = await callWorker(
    jsonRequest("/api/staff/patients", body, { method:"PUT", headers:{ cookie } }),
    db,
  );
  assert.equal(response.status, 200);
  return response.json();
}

function exactBookingRequest(cookie, body) {
  return jsonRequest("/api/staff/bookings/exact", body, {
    method:"POST",
    headers:{ cookie },
  });
}

test("CRM exact booking uses canonical creation rules and persists patient_id", async () => {
  await withD1(async (db, raw) => {
    const cookie = await seedStaffSession(db, {
      email:"exact-booking-registrar@example.com",
      role:"registrar",
      organizationId:1,
    });
    const patient = await createPatient(db, cookie, {
      phone:"+380501234567",
      displayName:"Exact Booking Patient",
      birthDate:"1980-01-10",
    });
    const patientId = patient.profile.patientId;
    const date = nextBookableDate();

    const response = await callWorker(exactBookingRequest(cookie, {
      patientId,
      name:"Exact Booking Patient",
      phone:"+380501234567",
      dob:"1980-01-10",
      patientCategory:"civilian",
      serviceCode:"401",
      date,
      time:"08:00",
      referralType:"none",
      comment:"",
    }), db);
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.patientId, patientId);
    assert.ok(Number(body.bookingId) > 0);

    const booking = raw.prepare(
      `SELECT id, patient_id AS patientId, phone_normalized AS phoneNormalized, date_of_birth AS dob
       FROM bookings WHERE organization_id = 1 AND code = ?`,
    ).get(body.code);
    assert.equal(booking.patientId, patientId);
    assert.equal(booking.phoneNormalized, "380501234567");
    assert.equal(booking.dob, "1980-01-10");

    const linkEvent = raw.prepare(
      `SELECT action FROM booking_events
       WHERE organization_id = 1 AND booking_id = ? AND action = 'patient_linked'`,
    ).get(booking.id);
    assert.equal(linkEvent.action, "patient_linked");
  });
});

test("exact booking fails closed for stale contact data or another tenant patient_id", async () => {
  await withD1(async (db, raw) => {
    const cookie = await seedStaffSession(db, {
      email:"exact-booking-guard@example.com",
      role:"registrar",
      organizationId:1,
    });
    const patient = await createPatient(db, cookie, {
      phone:"+380501234567",
      displayName:"Guard Patient",
      birthDate:"1980-01-10",
    });
    const date = nextBookableDate();
    const base = {
      patientId:patient.profile.patientId,
      name:"Guard Patient",
      phone:"+380501234567",
      dob:"1980-01-10",
      patientCategory:"civilian",
      serviceCode:"401",
      date,
      time:"08:00",
      referralType:"none",
    };

    const wrongPhone = await callWorker(exactBookingRequest(cookie, {
      ...base, phone:"+380671111111",
    }), db);
    assert.equal(wrongPhone.status, 409);

    const wrongDob = await callWorker(exactBookingRequest(cookie, {
      ...base, dob:"1981-02-02",
    }), db);
    assert.equal(wrongDob.status, 409);

    await db.prepare(
      "INSERT INTO organizations (id, slug, name, active) VALUES (2, 'exact-booking-other', 'Other', 1)",
    ).run();
    await db.prepare(
      `INSERT INTO patient_profiles
        (organization_id, phone_normalized, display_name, birth_date, birth_year, updated_by)
       VALUES (2, '380501234567', 'Other Tenant Patient', '1980-01-10', 1980, 'seed')`,
    ).run();
    const foreignPatientId = raw.prepare(
      "SELECT patient_id AS patientId FROM patient_profiles WHERE organization_id = 2 LIMIT 1",
    ).get().patientId;
    const crossTenant = await callWorker(exactBookingRequest(cookie, {
      ...base, patientId:foreignPatientId,
    }), db);
    assert.equal(crossTenant.status, 404);

    const createdCount = raw.prepare(
      "SELECT COUNT(*) AS n FROM bookings WHERE organization_id = 1 AND name = 'Guard Patient'",
    ).get().n;
    assert.equal(createdCount, 0, "identity guards run before canonical booking creation");
  });
});
