import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, withD1 } from "./helpers/d1.mjs";
import { createPatientSession } from "../lib/patient-auth.ts";

const PHONE = "380971234567";
const DOB = "1991-02-03";
const CODE_A = "RD-AMBIG001";
const CODE_B = "RD-AMBIG002";

async function seedLegacyBooking(db, code, name, time) {
  const inserted = await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, phone_normalized, date_of_birth,
       service, service_code, desired_date, desired_time, status, patient_category)
     VALUES (1, ?, ?, ?, ?, ?, 'КТ', 'CT-01', '2026-09-10', ?, 'confirmed', 'civilian')`,
  ).bind(code, name, `+${PHONE}`, PHONE, DOB, time).run();
  return Number(inserted.meta.last_row_id);
}

async function seedIssuedProtocol(db, bookingId) {
  await db.prepare(
    `INSERT INTO protocols
      (organization_id, booking_id, number, status, version, author_email, updated_by,
       findings, conclusion, signed_by, signed_at, signed_version)
     VALUES (1, ?, 'PROTO-A', 'signed', 1, 'doctor@example.com', 'doctor@example.com',
       'Finding A', 'Result A', 'doctor@example.com', CURRENT_TIMESTAMP, 1)`,
  ).bind(bookingId).run();
  await db.prepare(
    "UPDATE protocols SET status='issued' WHERE organization_id=1 AND booking_id=? AND status='signed'"
  ).bind(bookingId).run();
}

function request(path, cookie, body = undefined) {
  return jsonRequest(path, body, { method:"POST", headers:{ cookie } });
}

test("ambiguous legacy DOB session cannot expand across patient results or messaging identity", async () => {
  await withD1(async (db) => {
    const bookingA = await seedLegacyBooking(db, CODE_A, "Legacy Alpha", "10:00");
    await seedLegacyBooking(db, CODE_B, "Legacy Beta", "10:30");
    await seedIssuedProtocol(db, bookingA);

    const raw = await createPatientSession(db, PHONE, 1, { kind:"dob", value:DOB });
    const cookie = `rid_patient=${raw}`;

    const cabinet = await callWorker(request("/api/my-bookings", cookie), db);
    assert.equal(cabinet.status, 409);
    const cabinetText = await cabinet.text();
    assert.doesNotMatch(cabinetText, /Legacy Alpha|Legacy Beta|Result A/);

    const protocol = await callWorker(request("/api/my-protocol", cookie, { code:CODE_A }), db);
    assert.equal(protocol.status, 409);
    const protocolText = await protocol.text();
    assert.doesNotMatch(protocolText, /Legacy Alpha|Legacy Beta|Result A/);

    const telegram = await callWorker(request("/api/my-telegram-link", cookie), db);
    assert.equal(telegram.status, 409);
    assert.doesNotMatch(await telegram.text(), /t\.me\//);
  });
});

test("exact legacy booking-code session remains compatible and exposes only that booking", async () => {
  await withD1(async (db) => {
    const bookingA = await seedLegacyBooking(db, CODE_A, "Legacy Alpha", "10:00");
    await seedLegacyBooking(db, CODE_B, "Legacy Beta", "10:30");
    await seedIssuedProtocol(db, bookingA);

    const raw = await createPatientSession(db, PHONE, 1, { kind:"booking", value:CODE_A });
    const cookie = `rid_patient=${raw}`;

    const cabinet = await callWorker(request("/api/my-bookings", cookie), db);
    assert.equal(cabinet.status, 200);
    const cabinetBody = await cabinet.json();
    assert.deepEqual(cabinetBody.bookings.map((row) => row.code), [CODE_A]);
    assert.equal(cabinetBody.bookings[0].patientName, "Legacy Alpha");

    const protocol = await callWorker(request("/api/my-protocol", cookie, { code:CODE_A }), db);
    assert.equal(protocol.status, 200);
    const protocolBody = await protocol.json();
    assert.equal(protocolBody.protocol.patient, "Legacy Alpha");
    assert.equal(protocolBody.protocol.conclusion, "Result A");
    assert.doesNotMatch(JSON.stringify(protocolBody), /Legacy Beta/);
  });
});
