// Профіль-ізоляція від крос-контамінації (за мотивами health-os «profile
// integrity check»). RadiologyOS уже тримає ідентичність пацієнта під
// тригерами БД; цей набір ЗАКРІПЛЮЄ як регрес ті інваріанти, що досі не мали
// прямого тесту: короткоживучі та персистентні прив'язки (сесії, OTP, токени
// й ідентичності Telegram) не можна прив'язати до пацієнта поза його
// tenant/контактом, а вже проставлений patient_id незмінний.

import assert from "node:assert/strict";
import test from "node:test";
import { withD1 } from "./helpers/d1.mjs";

const PID = (c) => c.repeat(32);
const FUTURE = "2099-01-01 00:00:00";

// Легітимно прив'язана ідентичність: картка + заявка того ж тенанта з тим
// самим контактом і датою народження. Далі сесія/OTP/Telegram МОЖУТЬ на неї
// послатися (identity_kind='dob').
async function linkedIdentity(db, { org = 1, pid = PID("a"), phone = "380501112233", dob = "1990-05-01", code = "PI-1" } = {}) {
  await db.prepare(
    `INSERT INTO patient_profiles (patient_id, organization_id, phone_normalized, display_name, birth_date, updated_by)
     VALUES (?, ?, ?, 'Пацієнт', ?, 'test')`
  ).bind(pid, org, phone, dob).run();
  await db.prepare(
    `INSERT INTO bookings (organization_id, code, name, phone, phone_normalized, patient_id, date_of_birth,
       service, desired_date, desired_time, status)
     VALUES (?, ?, 'Пацієнт', ?, ?, ?, ?, 'КТ', '2026-09-01', '10:00', 'confirmed')`
  ).bind(org, code, `+${phone}`, phone, pid, dob).run();
  return { org, pid, phone, dob, code };
}

test("patient_sessions: valid link is accepted, foreign/unlinked patient_id is rejected, patient_id is immutable", async () => {
  await withD1(async (db) => {
    const id = await linkedIdentity(db);

    // Легітимна прив'язка до пацієнта свого тенанта за DOB — дозволена.
    await db.prepare(
      `INSERT INTO patient_sessions (token_hash, phone_normalized, organization_id, identity_kind, identity_value, patient_id, expires_at)
       VALUES ('ok-sess', ?, ?, 'dob', ?, ?, ?)`
    ).bind(id.phone, id.org, id.dob, id.pid, FUTURE).run();

    // Прив'язка до patient_id БЕЗ відповідної заявки — заборонена.
    await assert.rejects(
      db.prepare(
        `INSERT INTO patient_sessions (token_hash, phone_normalized, organization_id, identity_kind, identity_value, patient_id, expires_at)
         VALUES ('bad-sess', '380509998877', 1, 'dob', '1990-05-01', ?, ?)`
      ).bind(PID("f"), FUTURE).run(),
      /patient session patient link invalid/i,
    );

    // Крос-тенант: та сама картка, але в чужій організації — немає заявки → заборонено.
    await assert.rejects(
      db.prepare(
        `INSERT INTO patient_sessions (token_hash, phone_normalized, organization_id, identity_kind, identity_value, patient_id, expires_at)
         VALUES ('cross-sess', ?, 2, 'dob', ?, ?, ?)`
      ).bind(id.phone, id.dob, id.pid, FUTURE).run(),
      /patient session patient link invalid/i,
    );

    // patient_id незмінний після створення.
    await assert.rejects(
      db.prepare("UPDATE patient_sessions SET patient_id = ? WHERE token_hash = 'ok-sess'").bind(PID("b")).run(),
      /patient session patient id is immutable/i,
    );
  });
});

test("patient_otp_challenges: unlinked patient_id is rejected and patient_id is immutable", async () => {
  await withD1(async (db) => {
    const id = await linkedIdentity(db);

    await db.prepare(
      `INSERT INTO patient_otp_challenges (id, organization_id, phone_normalized, code_hash, expires_at, identity_kind, identity_value, patient_id)
       VALUES ('ok-otp', ?, ?, 'h', ?, 'dob', ?, ?)`
    ).bind(id.org, id.phone, FUTURE, id.dob, id.pid).run();

    await assert.rejects(
      db.prepare(
        `INSERT INTO patient_otp_challenges (id, organization_id, phone_normalized, code_hash, expires_at, identity_kind, identity_value, patient_id)
         VALUES ('bad-otp', 1, '380509998877', 'h', ?, 'dob', '1990-05-01', ?)`
      ).bind(FUTURE, PID("f")).run(),
      /patient OTP patient link invalid/i,
    );

    await assert.rejects(
      db.prepare("UPDATE patient_otp_challenges SET patient_id = ? WHERE id = 'ok-otp'").bind(PID("b")).run(),
      /patient OTP patient id is immutable/i,
    );
  });
});

test("patient_telegram_identities: unlinked patient_id is rejected and patient_id is immutable", async () => {
  await withD1(async (db) => {
    const id = await linkedIdentity(db);

    await db.prepare(
      `INSERT INTO patient_telegram_identities (organization_id, phone_normalized, identity_kind, identity_value, telegram_chat_id, patient_id)
       VALUES (?, ?, 'dob', ?, '555', ?)`
    ).bind(id.org, id.phone, id.dob, id.pid).run();

    await assert.rejects(
      db.prepare(
        `INSERT INTO patient_telegram_identities (organization_id, phone_normalized, identity_kind, identity_value, telegram_chat_id, patient_id)
         VALUES (1, '380509998877', 'dob', '1990-05-01', '556', ?)`
      ).bind(PID("f")).run(),
      /patient Telegram patient link invalid/i,
    );

    await assert.rejects(
      db.prepare(
        "UPDATE patient_telegram_identities SET patient_id = ? WHERE organization_id = ? AND phone_normalized = ? AND identity_kind = 'dob' AND identity_value = ?"
      ).bind(PID("b"), id.org, id.phone, id.dob).run(),
      /patient Telegram patient id is immutable/i,
    );
  });
});

test("telegram_link_tokens: unlinked patient_id is rejected and patient_id is immutable", async () => {
  await withD1(async (db) => {
    const id = await linkedIdentity(db);

    await db.prepare(
      `INSERT INTO telegram_link_tokens (token_hash, phone_normalized, organization_id, identity_kind, identity_value, patient_id, expires_at)
       VALUES ('ok-tok', ?, ?, 'dob', ?, ?, ?)`
    ).bind(id.phone, id.org, id.dob, id.pid, FUTURE).run();

    await assert.rejects(
      db.prepare(
        `INSERT INTO telegram_link_tokens (token_hash, phone_normalized, organization_id, identity_kind, identity_value, patient_id, expires_at)
         VALUES ('bad-tok', '380509998877', 1, 'dob', '1990-05-01', ?, ?)`
      ).bind(PID("f"), FUTURE).run(),
      /Telegram patient link invalid/i,
    );

    await assert.rejects(
      db.prepare("UPDATE telegram_link_tokens SET patient_id = ? WHERE token_hash = 'ok-tok'").bind(PID("b")).run(),
      /Telegram patient id is immutable/i,
    );
  });
});

test("patient_profiles organization is immutable — a patient cannot be moved between tenants", async () => {
  await withD1(async (db) => {
    const id = await linkedIdentity(db);
    await assert.rejects(
      db.prepare("UPDATE patient_profiles SET organization_id = 2 WHERE patient_id = ?").bind(id.pid).run(),
      /patient organization is immutable/i,
    );
  });
});
