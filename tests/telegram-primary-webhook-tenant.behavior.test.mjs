import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { callWorker, jsonRequest, withD1 } from "./helpers/d1.mjs";

function tokenHash(raw) {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

async function setGlobal(db, key, value) {
  await db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).bind(key, value).run();
}

async function addBooking(db, { id, organizationId, code, phone }) {
  await db.prepare(
    `INSERT INTO bookings
      (id, organization_id, code, name, phone, phone_normalized, service, service_code,
       desired_date, desired_time, status, date_of_birth, patient_category)
     VALUES (?, ?, ?, ?, ?, ?, 'КТ', '408', '2026-09-15', ?, 'confirmed', '1990-05-05', 'civilian')`,
  ).bind(id, organizationId, code, `Patient ${code}`, `+${phone}`, phone, organizationId === 1 ? "09:00" : "10:00").run();
}

async function addTelegramToken(db, { rawToken, organizationId, phone, code }) {
  await db.prepare(
    `INSERT INTO telegram_link_tokens
      (token_hash, organization_id, phone_normalized, identity_kind, identity_value, expires_at)
     VALUES (?, ?, ?, 'booking', ?, datetime('now', '+15 minutes'))`,
  ).bind(tokenHash(rawToken), organizationId, phone, code).run();
}

async function postStart(db, secret, chatId, rawToken) {
  return callWorker(
    jsonRequest(
      "/api/telegram/webhook",
      { message: { chat: { id: chatId }, text: `/start ${rawToken}` } },
      { headers: { "x-telegram-bot-api-secret-token": secret } },
    ),
    db,
  );
}

test("global Telegram webhook consumes but never binds a secondary-tenant token", async () => {
  await withD1(async (db) => {
    await db.prepare(
      "INSERT INTO organizations (id, slug, name, active) VALUES (2, 'telegram-two', 'Telegram Two', 1)",
    ).run();
    const secret = "telegram-webhook-secret";
    const phone = "380502226611";
    const code = "TG-ORG2-BOUNDARY";
    const rawToken = "a".repeat(64);
    await setGlobal(db, "telegram_webhook_secret", secret);
    await addBooking(db, { id: 2701, organizationId: 2, code, phone });
    await addTelegramToken(db, { rawToken, organizationId: 2, phone, code });

    const response = await postStart(db, secret, 22002, rawToken);
    assert.equal(response.status, 200);

    const links = await db.prepare(
      `SELECT COUNT(*) AS n FROM patient_telegram_identities
       WHERE organization_id = 2 AND phone_normalized = ? AND identity_kind = 'booking' AND identity_value = ?`,
    ).bind(phone, code).first("n");
    assert.equal(links, 0);

    const remainingToken = await db.prepare(
      "SELECT COUNT(*) AS n FROM telegram_link_tokens WHERE token_hash = ?",
    ).bind(tokenHash(rawToken)).first("n");
    assert.equal(remainingToken, 0);
  });
});

test("global Telegram webhook still binds a valid primary-tenant token", async () => {
  await withD1(async (db) => {
    const secret = "telegram-webhook-secret";
    const phone = "380502226622";
    const code = "TG-ORG1-BOUNDARY";
    const rawToken = "b".repeat(64);
    await setGlobal(db, "telegram_webhook_secret", secret);
    await addBooking(db, { id: 2702, organizationId: 1, code, phone });
    await addTelegramToken(db, { rawToken, organizationId: 1, phone, code });

    const response = await postStart(db, secret, 11001, rawToken);
    assert.equal(response.status, 200);

    const link = await db.prepare(
      `SELECT telegram_chat_id AS chatId FROM patient_telegram_identities
       WHERE organization_id = 1 AND phone_normalized = ? AND identity_kind = 'booking' AND identity_value = ?`,
    ).bind(phone, code).first();
    assert.equal(link?.chatId, "11001");

    const remainingToken = await db.prepare(
      "SELECT COUNT(*) AS n FROM telegram_link_tokens WHERE token_hash = ?",
    ).bind(tokenHash(rawToken)).first("n");
    assert.equal(remainingToken, 0);
  });
});
