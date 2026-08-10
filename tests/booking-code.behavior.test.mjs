// Людино-зрозумілий код заявки RD-РРММДД-N: формат, послідовна нумерація,
// і що кабінет пацієнта приймає новий код (нормалізація/скасування).

import assert from "node:assert/strict";
import test from "node:test";
import { withD1, jsonRequest, callWorker, seedPatientSession } from "./helpers/d1.mjs";

const CONSENT_VERSION = "2026-07-29";
const validBody = (over = {}) => ({
  name: "Іваненко Іван Іванович", phone: "+380971112233", dob: "1990-05-05",
  category: "civilian", items: [{ code: "201" }], referralType: "none",
  comment: "", source: "", consent: true, consentVersion: CONSENT_VERSION, ...over,
});
const book = (db, key) =>
  callWorker(jsonRequest("/api/site-booking", validBody(), { headers: { "idempotency-key": key } }), db);

test("codes are RD-YYMMDD-N and increment per day", async () => {
  await withD1(async (db) => {
    const a = await (await book(db, "code-key-00000001")).json();
    const b = await (await book(db, "code-key-00000002")).json();
    assert.match(a.code, /^RD-\d{6}-\d{3,}$/);
    assert.match(b.code, /^RD-\d{6}-\d{3,}$/);
    // Той самий день, послідовні номери.
    const day = (c) => c.slice(3, 9), num = (c) => Number(c.split("-")[2]);
    assert.equal(day(a.code), day(b.code));
    assert.equal(num(b.code), num(a.code) + 1);
    assert.equal(num(a.code), 1); // перша заявка дня — 001
  });
});

test("the patient cabinet accepts the new code format (cancel by code)", async () => {
  await withD1(async (db) => {
    // Заявка з новим кодом + активна сесія пацієнта за телефоном.
    await db.prepare(
      `INSERT INTO bookings (code, name, phone, phone_normalized, service, service_code,
         desired_date, desired_time, status, date_of_birth, patient_category, organization_id)
       VALUES ('RD-260810-004','Пацієнт','+380971112233','380971112233','КТ','CT-01',
         '2026-09-01','10:00','new','1990-05-05','civilian',1)`
    ).run();
    const cookie = await seedPatientSession(db, "380971112233");
    const res = await callWorker(
      jsonRequest("/api/booking-status", { code: "RD-260810-004", action: "cancel" },
        { method: "PATCH", headers: { cookie } }), db);
    assert.equal(res.status, 200); // код нового формату розпізнано й скасовано
    const st = await db.prepare("SELECT status FROM bookings WHERE code = 'RD-260810-004'").first("status");
    assert.equal(st, "cancelled");
  });
});

test("generation helper is used by every booking entry point (no raw RD-<uuid>)", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const p of ["app/api/site-booking/route.ts", "app/api/staff/bookings/route.ts", "app/api/bookings/route.ts"]) {
    const src = await readFile(new URL(`../${p}`, import.meta.url), "utf8");
    assert.match(src, /nextBookingCode\(db\)/, `${p} має вживати nextBookingCode`);
    assert.doesNotMatch(src, /RD-\$\{crypto\.randomUUID/, `${p} не має генерувати сирий RD-uuid`);
  }
});
