import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedPatientSession, withD1 } from "./helpers/d1.mjs";

const PHONE = "380501112233";
const DOB_A = "1980-01-10";
const DOB_B = "2005-06-20";
const CODE_A = "RD-FAMILY001";
const CODE_B = "RD-FAMILY002";

async function seedFamilyBooking(db, { code, name, dob, time, amount }) {
  const result = await db.prepare(
    `INSERT INTO bookings
      (organization_id, code, name, phone, phone_normalized, date_of_birth,
       service, service_code, equipment_id, desired_date, desired_time,
       patient_category, payment_status, payment_amount, status)
     VALUES (1, ?, ?, '+380501112233', ?, ?, 'КТ', '403', 'ct',
       '2026-09-10', ?, 'civilian', 'pending', ?, 'confirmed')`
  ).bind(code, name, PHONE, dob, time, amount).run();
  return Number(result.meta.last_row_id);
}

async function issueProtocol(db, bookingId, number, conclusion) {
  await db.prepare(
    `INSERT INTO protocols
      (organization_id, booking_id, number, status, findings, conclusion, updated_by)
     VALUES (1, ?, ?, 'issued', 'Опис', ?, 'doctor@example.com')`
  ).bind(bookingId, number, conclusion).run();
}

function patientRequest(path, cookie, body, method = "POST") {
  return jsonRequest(path, body, { method, headers:{ cookie }, ip:"198.51.100.77" });
}

test("DOB-scoped patient session cannot cross a shared family phone boundary", async () => {
  await withD1(async (db) => {
    const bookingA = await seedFamilyBooking(db, {
      code:CODE_A, name:"Пацієнт А", dob:DOB_A, time:"10:00", amount:1500,
    });
    const bookingB = await seedFamilyBooking(db, {
      code:CODE_B, name:"Пацієнт Б", dob:DOB_B, time:"11:00", amount:2500,
    });
    await issueProtocol(db, bookingA, "PR-A", "Висновок А");
    await issueProtocol(db, bookingB, "PR-B", "Висновок Б — секрет");

    const cookie = await seedPatientSession(db, PHONE, 1, { kind:"dob", value:DOB_A });

    const listResponse = await callWorker(patientRequest("/api/my-bookings", cookie), db);
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    assert.deepEqual(list.bookings.map((item) => item.code), [CODE_A]);
    assert.doesNotMatch(JSON.stringify(list), /Пацієнт Б|PR-B|2500/);

    const ownProtocol = await callWorker(patientRequest("/api/my-protocol", cookie, { code:CODE_A }), db);
    assert.equal(ownProtocol.status, 200);
    const ownProtocolBody = await ownProtocol.json();
    assert.equal(ownProtocolBody.protocol.conclusion, "Висновок А");

    const foreignProtocol = await callWorker(patientRequest("/api/my-protocol", cookie, { code:CODE_B }), db);
    assert.equal(foreignProtocol.status, 404);
    assert.doesNotMatch(JSON.stringify(await foreignProtocol.json()), /Висновок Б|Пацієнт Б/);

    const foreignStatus = await callWorker(patientRequest("/api/booking-status", cookie, { code:CODE_B }), db);
    assert.equal(foreignStatus.status, 404);

    const foreignCancel = await callWorker(patientRequest(
      "/api/booking-status", cookie, { code:CODE_B, action:"cancel" }, "PATCH",
    ), db);
    assert.equal(foreignCancel.status, 404);
    const stillConfirmed = await db.prepare("SELECT status FROM bookings WHERE id = ?").bind(bookingB).first("status");
    assert.equal(stillConfirmed, "confirmed");

    const foreignPayment = await callWorker(patientRequest("/api/pay-link", cookie, { code:CODE_B }), db);
    assert.equal(foreignPayment.status, 404);
    const foreignTransactions = await db.prepare(
      "SELECT COUNT(*) AS n FROM payment_transactions WHERE organization_id = 1 AND booking_id = ?",
    ).bind(bookingB).first("n");
    assert.equal(foreignTransactions, 0);
  });
});

test("booking-code session is restricted to that exact booking even on a shared phone", async () => {
  await withD1(async (db) => {
    await seedFamilyBooking(db, {
      code:CODE_A, name:"Пацієнт А", dob:DOB_A, time:"10:00", amount:1500,
    });
    await seedFamilyBooking(db, {
      code:CODE_B, name:"Пацієнт Б", dob:DOB_B, time:"11:00", amount:2500,
    });
    const cookie = await seedPatientSession(db, PHONE, 1, { kind:"booking", value:CODE_B });
    const response = await callWorker(patientRequest("/api/my-bookings", cookie), db);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.bookings.map((item) => item.code), [CODE_B]);
  });
});

test("D1 rejects unscoped or invented Telegram identities for a shared phone", async () => {
  await withD1(async (db) => {
    await seedFamilyBooking(db, {
      code:CODE_A, name:"Пацієнт А", dob:DOB_A, time:"10:00", amount:1500,
    });

    await assert.rejects(
      db.prepare(
        `INSERT INTO telegram_link_tokens
          (token_hash, organization_id, phone_normalized, identity_kind, identity_value, expires_at)
         VALUES ('invalid-link', 1, ?, 'dob', '1970-01-01', datetime('now', '+15 minutes'))`
      ).bind(PHONE).run(),
      /identity scope invalid/i,
    );

    await assert.rejects(
      db.prepare(
        `INSERT INTO patient_telegram_identities
          (organization_id, phone_normalized, identity_kind, identity_value, telegram_chat_id)
         VALUES (1, ?, 'booking', 'RD-NOTREAL1', 'chat-wrong')`
      ).bind(PHONE).run(),
      /identity scope invalid/i,
    );
  });
});
