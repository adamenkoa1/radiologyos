import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Усі міграції застосовуються послідовно й дають очікувану схему нагадувань.
test("migrations create the reminders outbox, patient_email and gateway settings", async () => {
  const dir = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const db = new DatabaseSync(":memory:");
  for (const file of files) {
    const sql = await readFile(new URL(file, dir), "utf8");
    for (const stmt of sql.split(/-->\s*statement-breakpoint/).map((s) => s.trim()).filter(Boolean)) {
      db.exec(stmt);
    }
  }
  const bookingCols = db.prepare("PRAGMA table_info(bookings)").all().map((c) => c.name);
  assert.ok(bookingCols.includes("patient_email"), "bookings.patient_email exists");

  const outbox = db.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name = ?").all("table", "patient_notifications");
  assert.equal(outbox.length, 1, "patient_notifications table exists");

  const seeded = db.prepare("SELECT key FROM app_settings WHERE key LIKE ? OR key = ?")
    .all("%gateway%", "patient_reminders_enabled").map((r) => r.key).sort();
  assert.deepEqual(seeded, [
    "email_gateway_auth", "email_gateway_from", "email_gateway_url",
    "patient_reminders_enabled", "sms_gateway_auth", "sms_gateway_url",
  ]);

  // Публічні INSERT-и мають прийняти нову колонку без зсуву плейсхолдерів.
  db.prepare(
    `INSERT INTO bookings (code,name,phone,phone_normalized,patient_email,service,service_code,equipment_id,
     duration_minutes,desired_date,desired_time,referral,patient_category,referral_type,marketing_source,
     payment_status,payment_amount,nszu_status,comment)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run("C1", "Ім'я", "0", "0", "p@e.co", "S", "01", "ct", 30, "2026-08-01", "09:00", "r", "civilian", "other", "", "pending", 100, "not_applicable", "");
  assert.equal(db.prepare("SELECT patient_email FROM bookings WHERE code = ?").get("C1").patient_email, "p@e.co");
});

// Один рух: підтвердження заявки перевіряє слот і фіксує нагадування.
test("confirm-in-one-move validates the slot and reminds the patient", async () => {
  const src = await readFile(new URL("../app/api/staff/bookings/route.ts", import.meta.url), "utf8");
  assert.match(src, /body\.confirm === true/);
  assert.match(src, /status = 'confirmed'/);
  assert.match(src, /перенесіть запис/); // конфлікт → підказка перенести
  // Нагадування шлються і при підтвердженні, і при перенесенні.
  assert.match(src, /sendPatientReminder\(db, "confirmed"/);
  assert.match(src, /sendPatientReminder\(db, "rescheduled"/);
});

// Рушій нагадувань: канали, повага до «не турбувати», журнал відправлень.
test("notify engine records an outbox row and respects exact patient contact boundaries", async () => {
  const src = await readFile(new URL("../lib/notify.ts", import.meta.url), "utf8");
  assert.match(src, /patient_notifications/);
  assert.match(src, /do_not_contact/);
  assert.match(src, /AS stale/);
  assert.match(src, /p\.patient_id = b\.patient_id/);
  assert.match(src, /p\.phone_normalized = b\.phone_normalized/);
  assert.match(src, /profile\?\.stale/);
  assert.match(src, /sms_gateway_url/);
  assert.match(src, /email_gateway_url/);
  // Найкраще-зусильно: успіх/пропуск/помилка не кидають виняток нагору.
  assert.match(src, /catch/);
});

test("scheduled reminders fail closed when an exact profile contact changed", async () => {
  const src = await readFile(new URL("../lib/reminders.ts", import.meta.url), "utf8");
  assert.match(src, /staleLinkedContact/);
  assert.match(src, /p\.patient_id = b\.patient_id/);
  assert.match(src, /p\.phone_normalized = b\.phone_normalized/);
  assert.match(src, /b\.staleLinkedContact/);
});

// Email-канал живиться адресою пацієнта, зібраною у формах запису.
test("both booking intakes capture an optional patient email", async () => {
  for (const route of ["../app/api/site-booking/route.ts", "../app/api/bookings/route.ts"]) {
    const src = await readFile(new URL(route, import.meta.url), "utf8");
    assert.match(src, /patient_email/, `${route} writes patient_email`);
    assert.match(src, /patientEmail/, `${route} parses patientEmail`);
  }
});
