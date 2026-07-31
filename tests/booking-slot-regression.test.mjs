import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

// Регресія: перевірка конфлікту слотів раніше використовувала
// time(desired_time, …) → 'HH:MM:SS', що лексикографічно > 'HH:MM' і хибно
// вважало сусідні (back-to-back) слоти зайнятими. Виправлено на
// strftime('%H:%M', …). Тут ганяємо саму SQL проти in-memory SQLite.

async function freshDb() {
  const dir = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const db = new DatabaseSync(":memory:");
  for (const f of files) {
    const sql = await readFile(new URL(f, dir), "utf8");
    for (const s of sql.split(/-->\s*statement-breakpoint/).map((x) => x.trim()).filter(Boolean)) db.exec(s);
  }
  return db;
}

const CONFLICT_SQL = `SELECT id FROM bookings WHERE equipment_id = ? AND desired_date = ?
   AND status IN ('confirmed','rescheduled') AND desired_time < ?
   AND strftime('%H:%M', desired_time, '+' || duration_minutes || ' minutes') > ? LIMIT 1`;

function seedExisting(db) {
  // Наявний запис КТ 08:30–09:00 (30 хв), підтверджений.
  db.prepare(
    `INSERT INTO bookings (code, name, phone, phone_normalized, service, equipment_id,
       duration_minutes, desired_date, desired_time, status)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run("RD-A", "Тест", "0970000000", "380970000000", "КТ", "ct", 30, "2026-08-01", "08:30", "confirmed");
}

test("adjacent back-to-back slot is NOT a conflict (09:00 after 08:30–09:00)", async () => {
  const db = await freshDb();
  seedExisting(db);
  // Нова спроба 09:00–09:30: endTime='09:30', desiredTime='09:00'.
  const row = db.prepare(CONFLICT_SQL).get("ct", "2026-08-01", "09:30", "09:00");
  assert.ok(!row, "сусідній слот 09:00 має бути вільним");
});

test("genuinely overlapping slot IS a conflict (08:45 over 08:30–09:00)", async () => {
  const db = await freshDb();
  seedExisting(db);
  // Нова спроба 08:45–09:15: endTime='09:15', desiredTime='08:45'.
  const row = db.prepare(CONFLICT_SQL).get("ct", "2026-08-01", "09:15", "08:45");
  assert.ok(row, "перетин 08:45 має бути зайнятим");
});

test("earlier adjacent slot is NOT a conflict (08:00–08:30 before 08:30)", async () => {
  const db = await freshDb();
  seedExisting(db);
  const row = db.prepare(CONFLICT_SQL).get("ct", "2026-08-01", "08:30", "08:00");
  assert.ok(!row, "сусідній ранній слот 08:00 має бути вільним");
});

test("route source uses strftime, not the buggy time() comparison", async () => {
  const route = await readFile(new URL("../app/api/staff/bookings/route.ts", import.meta.url), "utf8");
  assert.match(route, /strftime\('%H:%M', desired_time/);
  assert.doesNotMatch(route, /\btime\(desired_time, '\+' \|\| duration_minutes/);
});
