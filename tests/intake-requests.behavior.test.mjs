// Вхідні заявки (Telegram) — захоплення у вебхуку + черга реєстратора (MP, блок D).
// Реальний D1 через воркер: вільний текст стає заявкою (ідемпотентно); команди
// не захоплюються; GET/PATCH доступні реєстратору; підтвердження — чесний статус.

import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const SECRET = "wh_secret_abcdef0123456789";

async function seedWebhookSecret(db) {
  await db.prepare(
    "INSERT INTO organization_integration_settings (organization_id, key, value, updated_at, updated_by) VALUES (1,'telegram_webhook_secret',?,CURRENT_TIMESTAMP,'test') ON CONFLICT(organization_id,key) DO UPDATE SET value=excluded.value"
  ).bind(SECRET).run();
}

async function webhook(db, update) {
  return callWorker(new Request("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
    body: JSON.stringify(update),
  }), db);
}

async function listRequests(db, cookie, status = "") {
  const url = `http://localhost/api/staff/intake-requests${status ? `?status=${status}` : ""}`;
  const res = await callWorker(new Request(url, { headers: { cookie } }), db);
  const data = await res.json();
  return { status: res.status, requests: data.requests || [] };
}

test("a free-text Telegram message is captured as a new intake request", async () => {
  await withD1(async (db) => {
    await seedWebhookSecret(db);
    const admin = await seedStaffSession(db, { email: "reg@example.com", role: "registrar", organizationId: 1 });
    const res = await webhook(db, { update_id: 1001, message: { chat: { id: 555 }, text: "Доброго дня, хочу записатись на КТ грудної клітки" } });
    assert.equal(res.status, 200);
    const { requests } = await listRequests(db, admin);
    assert.equal(requests.length, 1, "request captured");
    assert.equal(requests[0].channel, "telegram");
    assert.equal(requests[0].status, "new");
    assert.match(requests[0].message, /КТ грудної клітки/);
    assert.equal(requests[0].contact, "555");
  });
});

test("idempotency: the same update_id delivered twice yields one request", async () => {
  await withD1(async (db) => {
    await seedWebhookSecret(db);
    const admin = await seedStaffSession(db, { email: "reg@example.com", role: "registrar", organizationId: 1 });
    await webhook(db, { update_id: 2002, message: { chat: { id: 7 }, text: "хочу УЗД" } });
    await webhook(db, { update_id: 2002, message: { chat: { id: 7 }, text: "хочу УЗД" } });
    const { requests } = await listRequests(db, admin);
    assert.equal(requests.length, 1, "duplicate delivery must not create a second request");
  });
});

test("commands (/start, /stop) are NOT captured as intake requests", async () => {
  await withD1(async (db) => {
    await seedWebhookSecret(db);
    const admin = await seedStaffSession(db, { email: "reg@example.com", role: "registrar", organizationId: 1 });
    await webhook(db, { update_id: 3003, message: { chat: { id: 9 }, text: "/start" } });
    await webhook(db, { update_id: 3004, message: { chat: { id: 9 }, text: "/stop" } });
    const { requests } = await listRequests(db, admin);
    assert.equal(requests.length, 0, "pure commands must not become requests");
  });
});

test("webhook with a wrong secret is rejected (fails closed)", async () => {
  await withD1(async (db) => {
    await seedWebhookSecret(db);
    const res = await callWorker(new Request("http://localhost/api/telegram/webhook", {
      method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "wrong" },
      body: JSON.stringify({ update_id: 1, message: { chat: { id: 1 }, text: "хочу КТ" } }),
    }), db);
    assert.equal(res.status, 401);
  });
});

test("registrar can claim, link and the queue reflects status; non-registrar is blocked", async () => {
  await withD1(async (db) => {
    await seedWebhookSecret(db);
    const reg = await seedStaffSession(db, { email: "reg@example.com", role: "registrar", organizationId: 1 });
    await webhook(db, { update_id: 4004, message: { chat: { id: 42 }, text: "запис на МРТ" } });
    const { requests } = await listRequests(db, reg);
    const reqId = requests[0].id;

    const claim = await callWorker(jsonRequest("/api/staff/intake-requests", { id: reqId, action: "claim" }, { method: "PATCH", headers: { cookie: reg } }), db);
    assert.equal(claim.status, 200);
    assert.equal((await claim.json()).status, "in_progress");

    // Створюємо дослідження (walk-in) і звʼязуємо заявку з ним.
    const study = await callWorker(jsonRequest("/api/staff/protocols/studies", { name: "Пацієнт Заявка", phone: "0501112233", serviceCode: "401" }, { method: "POST", headers: { cookie: reg } }), db);
    const { bookingId } = await study.json();
    const link = await callWorker(jsonRequest("/api/staff/intake-requests", { id: reqId, action: "link", bookingId }, { method: "PATCH", headers: { cookie: reg } }), db);
    assert.equal(link.status, 200);
    assert.equal((await link.json()).status, "converted");

    const converted = await listRequests(db, reg, "converted");
    assert.equal(converted.requests[0].linkedBookingId, bookingId);

    // Лікар-рентгенолог не опрацьовує заявки.
    const doc = await seedStaffSession(db, { email: "doc@example.com", role: "radiologist", organizationId: 1 });
    const denied = await callWorker(new Request("http://localhost/api/staff/intake-requests", { headers: { cookie: doc } }), db);
    assert.equal(denied.status, 403);
  });
});

test("confirmation returns an honest status when Telegram is not configured (no fake 'sent')", async () => {
  await withD1(async (db) => {
    await seedWebhookSecret(db);
    const reg = await seedStaffSession(db, { email: "reg@example.com", role: "registrar", organizationId: 1 });
    await webhook(db, { update_id: 5005, message: { chat: { id: 77 }, text: "хочу записатись" } });
    const { requests } = await listRequests(db, reg);
    const confirm = await callWorker(jsonRequest("/api/staff/intake-requests", { id: requests[0].id, action: "confirm", text: "Ваш запис підтверджено на завтра о 10:00." }, { method: "PATCH", headers: { cookie: reg } }), db);
    const data = await confirm.json();
    // Без токена бота — чесно sent:false, а не фальшиве «надіслано».
    assert.equal(data.sent, false);
    assert.ok(data.error, "honest error explaining why nothing was sent");
  });
});
