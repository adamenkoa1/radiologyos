// Поведінковий тест головного шляху «пацієнт створює заявку» проти живої
// SQLite-схеми: справжні INSERT-и, ціна, ідемпотентність (без подвійного запису).

import assert from "node:assert/strict";
import test from "node:test";
import { withD1, jsonRequest, callWorker } from "./helpers/d1.mjs";

const CONSENT_VERSION = "2026-07-29";

function validBody(over = {}) {
  return {
    name: "Іваненко Іван Іванович",
    phone: "+380971112233",
    dob: "1990-05-05",
    category: "civilian",
    items: [{ code: "201" }], // цифрова рентгенографія, доступна цивільним за замовчуванням
    referralType: "none",
    comment: "",
    source: "",
    consent: true,
    consentVersion: CONSENT_VERSION,
    ...over,
  };
}

const book = (db, body, key = "idem-key-abcdef123456") =>
  callWorker(jsonRequest("/api/site-booking", body, { headers: { "idempotency-key": key } }), db);

test("a valid civilian request creates a booking, priced and pending payment", async () => {
  await withD1(async (db) => {
    const res = await book(db, validBody());
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.match(data.code, /^RD-[A-Z0-9]{16}$/);

    const row = await db.prepare(
      "SELECT status, payment_status AS pay, payment_amount AS amount, patient_category AS cat FROM bookings WHERE code = ?"
    ).bind(data.code).first();
    assert.ok(row, "заявку збережено в БД");
    assert.equal(row.status, "new");
    assert.equal(row.cat, "civilian");
    assert.equal(row.pay, "pending");       // цивільний → очікує оплату
    assert.equal(row.amount, 500);          // ціна з каталогу для коду 201

    const events = await db.prepare(
      "SELECT COUNT(*) AS n FROM booking_events WHERE action = 'created'"
    ).first("n");
    assert.equal(events, 1);
  });
});

test("the same idempotency key never creates a second booking", async () => {
  await withD1(async (db) => {
    const first = await book(db, validBody(), "same-key-0001aaaa");
    const second = await book(db, validBody(), "same-key-0001aaaa");
    const a = await first.json();
    const b = await second.json();
    assert.equal(a.code, b.code); // та сама відповідь
    const count = await db.prepare("SELECT COUNT(*) AS n FROM bookings").first("n");
    assert.equal(count, 1);       // рівно одна заявка, не дві
  });
});

test("missing consent is refused", async () => {
  await withD1(async (db) => {
    const res = await book(db, validBody({ consent: false }), "key-consent-0001");
    assert.equal(res.status, 400);
    const count = await db.prepare("SELECT COUNT(*) AS n FROM bookings").first("n");
    assert.equal(count, 0);
  });
});

test("under-18 is refused (server-side, not only UI)", async () => {
  await withD1(async (db) => {
    const res = await book(db, validBody({ dob: "2015-01-01" }), "key-minor-000001");
    assert.equal(res.status, 400);
    const count = await db.prepare("SELECT COUNT(*) AS n FROM bookings").first("n");
    assert.equal(count, 0);
  });
});

test("duplicated services in one request are refused", async () => {
  await withD1(async (db) => {
    const res = await book(db, validBody({ items: [{ code: "201" }, { code: "201" }] }), "key-dupe-0000001");
    assert.equal(res.status, 400);
  });
});

test("a request without an idempotency key is refused", async () => {
  await withD1(async (db) => {
    const res = await callWorker(jsonRequest("/api/site-booking", validBody()), db);
    assert.equal(res.status, 400);
  });
});
