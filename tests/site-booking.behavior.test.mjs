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
    assert.match(data.code, /^RD-\d{6}-\d{3,}$/); // RD-РРММДД-N

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

test("public booking no longer stores a preferred contact channel", async () => {
  await withD1(async (db) => {
    const created = await book(db, validBody({ contactMethod: "email" }), "key-contact-ignored01");
    assert.equal(created.status, 201);
    const row = await db.prepare("SELECT patient_email AS email, comment FROM bookings LIMIT 1").first();
    assert.equal(row.email, "");
    assert.doesNotMatch(row.comment, /^\[contact:/);
    assert.doesNotMatch(row.comment, /Бажаний спосіб зв’язку/);
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

test("a second request from the same phone for the same active service is refused (no slot-spam)", async () => {
  await withD1(async (db) => {
    const first = await book(db, validBody(), "dedup-key-first-00001");
    assert.equal(first.status, 201);
    // Нова вкладка → інший idempotency-key, але той самий телефон і послуга.
    const second = await book(db, validBody(), "dedup-key-second-0001");
    assert.equal(second.status, 409);
    const count = await db.prepare("SELECT COUNT(*) AS n FROM bookings").first("n");
    assert.equal(count, 1); // рівно одна активна заявка, слот не задубльовано
  });
});

test("the same phone can still book a DIFFERENT service", async () => {
  await withD1(async (db) => {
    const a = await book(db, validBody({ items: [{ code: "201" }] }), "diff-svc-key-000001");
    assert.equal(a.status, 201);
    const b = await book(db, validBody({ items: [{ code: "101" }] }), "diff-svc-key-000002");
    assert.equal(b.status, 201); // інша послуга — дозволено
  });
});

test("re-booking the same service is allowed after the previous one is cancelled", async () => {
  await withD1(async (db) => {
    const first = await book(db, validBody(), "recancel-key-000001");
    const { code } = await first.json();
    await db.prepare("UPDATE bookings SET status='cancelled' WHERE code = ?").bind(code).run();
    const again = await book(db, validBody(), "recancel-key-000002");
    assert.equal(again.status, 201); // скасована заявка не блокує
  });
});

test("the confirmation response carries an add-to-calendar link per appointment", async () => {
  await withD1(async (db) => {
    const res = await book(db, validBody(), "calendar-key-000001");
    assert.equal(res.status, 201);
    const data = await res.json();
    const appt = data.appointments[0];
    const calUrl = new URL(appt.calendarUrl); // парсимо, а не шукаємо підрядок (CodeQL-safe)
    assert.equal(calUrl.hostname, "calendar.google.com");
    assert.match(calUrl.search, /dates=\d{8}T\d{6}/); // старт візиту у датах
  });
});

test("gibberish full name is refused server-side", async () => {
  await withD1(async (db) => {
    const res = await book(db, validBody({ name: "выв Володимир Павлівна" }), "gibber-key-0000001");
    assert.equal(res.status, 400);
    const count = await db.prepare("SELECT COUNT(*) AS n FROM bookings").first("n");
    assert.equal(count, 0);
  });
});
