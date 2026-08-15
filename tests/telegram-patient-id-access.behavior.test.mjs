import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedPatientSession, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const PHONE = "380501234567";
const DOB = "1985-04-12";
const PATIENT_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PATIENT_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const CODE_A = "RD-260930-1";
const CODE_B = "RD-260930-2";

async function setSetting(db, key, value) {
  await db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).bind(key, value).run();
}

async function seedExactPatient(db, { patientId, code, name, time }) {
  await db.prepare(
    `INSERT INTO patient_profiles
      (patient_id, organization_id, phone_normalized, display_name, birth_date, updated_by)
     VALUES (?, 1, ?, ?, ?, 'test@example.com')`,
  ).bind(patientId, PHONE, name, DOB).run();
  const result = await db.prepare(
    `INSERT INTO bookings
      (organization_id, patient_id, code, name, phone, phone_normalized, date_of_birth,
       service, desired_date, desired_time, status)
     VALUES (1, ?, ?, ?, ?, ?, ?, 'КТ', '2026-09-30', ?, 'confirmed')`,
  ).bind(patientId, code, name, `+${PHONE}`, PHONE, DOB, time).run();
  return Number(result.meta.last_row_id);
}

async function linkTelegramFromCabinet(db, { patientId, code, chatId }) {
  const cookie = await seedPatientSession(db, PHONE, 1, { kind:"dob", value:DOB }, patientId);
  const linkResponse = await callWorker(
    jsonRequest("/api/my-telegram-link", undefined, { method:"POST", headers:{ cookie } }),
    db,
  );
  assert.equal(linkResponse.status, 200);
  const linkBody = await linkResponse.json();
  const url = new URL(linkBody.url);
  const rawToken = url.searchParams.get("start");
  assert.match(rawToken || "", /^[a-f0-9]{64}$/);

  const tokenRow = await db.prepare(
    `SELECT identity_kind AS identityKind, identity_value AS identityValue, patient_id AS patientId
     FROM telegram_link_tokens WHERE patient_id = ? LIMIT 1`,
  ).bind(patientId).first();
  assert.deepEqual(
    { ...tokenRow },
    { identityKind:"booking", identityValue:code, patientId },
    "DOB proof must be canonicalized to a unique booking while retaining immutable patient_id",
  );

  const webhook = await callWorker(
    jsonRequest(
      "/api/telegram/webhook",
      { message:{ chat:{ id:chatId }, text:`/start ${rawToken}` } },
      { headers:{ "x-telegram-bot-api-secret-token":"patient-identity-secret" } },
    ),
    db,
  );
  assert.equal(webhook.status, 200);
}

test("same phone + same DOB exact patients retain separate Telegram identities and delivery", async () => {
  await withD1(async (db) => {
    await setSetting(db, "telegram_bot_token", "test-bot-token");
    await setSetting(db, "telegram_bot_username", "radiology_test_bot");
    await setSetting(db, "telegram_webhook_secret", "patient-identity-secret");

    const bookingA = await seedExactPatient(db, {
      patientId:PATIENT_A, code:CODE_A, name:"Пацієнт А", time:"10:00",
    });
    const bookingB = await seedExactPatient(db, {
      patientId:PATIENT_B, code:CODE_B, name:"Пацієнт Б", time:"11:00",
    });

    await linkTelegramFromCabinet(db, { patientId:PATIENT_A, code:CODE_A, chatId:111001 });
    await linkTelegramFromCabinet(db, { patientId:PATIENT_B, code:CODE_B, chatId:222002 });

    const identities = await db.prepare(
      `SELECT patient_id AS patientId, identity_kind AS identityKind,
              identity_value AS identityValue, telegram_chat_id AS chatId
       FROM patient_telegram_identities
       WHERE organization_id = 1 AND phone_normalized = ?
       ORDER BY patient_id`,
    ).bind(PHONE).all();
    assert.deepEqual(identities.results.map((row)=>({ ...row })), [
      { patientId:PATIENT_A, identityKind:"booking", identityValue:CODE_A, chatId:"111001" },
      { patientId:PATIENT_B, identityKind:"booking", identityValue:CODE_B, chatId:"222002" },
    ]);

    await assert.rejects(
      db.prepare(
        `INSERT INTO patient_telegram_identities
          (organization_id, phone_normalized, identity_kind, identity_value, patient_id, telegram_chat_id)
         VALUES (1, ?, 'booking', ?, ?, 'wrong-chat')`,
      ).bind(PHONE, CODE_B, PATIENT_A).run(),
      /patient link invalid/i,
      "D1 must reject a patient_id paired with another patient's booking proof",
    );

    const staffCookie = await seedStaffSession(db, { email:"telegram-admin@example.com", role:"admin" });
    const sent = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const target = String(input);
      if (target.includes("api.telegram.org") && target.endsWith("/sendMessage")) {
        sent.push(JSON.parse(String(init?.body || "{}")));
        return new Response(JSON.stringify({ ok:true, result:{} }), {
          status:200,
          headers:{ "content-type":"application/json" },
        });
      }
      return originalFetch(input, init);
    };
    try {
      const notifyA = await callWorker(
        jsonRequest(
          "/api/staff/notify",
          { bookingId:bookingA, message:"Повідомлення лише для А" },
          { method:"POST", headers:{ cookie:staffCookie } },
        ),
        db,
      );
      assert.equal(notifyA.status, 200);
      const notifyB = await callWorker(
        jsonRequest(
          "/api/staff/notify",
          { bookingId:bookingB, message:"Повідомлення лише для Б" },
          { method:"POST", headers:{ cookie:staffCookie } },
        ),
        db,
      );
      assert.equal(notifyB.status, 200);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.deepEqual(sent.map((item)=>String(item.chat_id)), ["111001", "222002"]);
    assert.match(sent[0].text, /лише для А/);
    assert.match(sent[1].text, /лише для Б/);
  });
});
