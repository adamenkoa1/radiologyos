import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { capacitySlots, occupiedMinutes } from "../lib/booking-capacity.ts";

async function freshDb() {
  const dir = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const db = new DatabaseSync(":memory:");
  for (const f of files) {
    const sql = await readFile(new URL(f, dir), "utf8");
    for (const statement of sql.split(/-->\s*statement-breakpoint/).map((x) => x.trim()).filter(Boolean)) {
      db.exec(statement);
    }
  }
  return db;
}

function insertLocks(db, slots) {
  const stmt = db.prepare(
    `INSERT INTO booking_capacity_locks
      (organization_id, equipment_id, booking_date, minute, booking_code)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const slot of slots) {
    stmt.run(slot.organizationId, slot.equipmentId, slot.date, slot.minute, slot.bookingCode);
  }
}

function insertBooking(db, { code, time, duration = 30, status = "confirmed", equipment = "ct", org = 1, date = "2026-08-10" }) {
  return db.prepare(
    `INSERT INTO bookings (
      organization_id, code, name, phone, phone_normalized, service,
      service_code, equipment_id, duration_minutes, desired_date, desired_time, status
    ) VALUES (?, ?, 'Test Patient', '0970000000', '380970000000', 'CT', 'ct-test', ?, ?, ?, ?, ?)`
  ).run(org, code, equipment, duration, date, time, status);
}

test("occupiedMinutes uses a half-open interval", () => {
  const minutes = occupiedMinutes("08:30", 30);
  assert.equal(minutes.length, 30);
  assert.equal(minutes[0], "08:30");
  assert.equal(minutes.at(-1), "08:59");
  assert.ok(!minutes.includes("09:00"));
});

test("adjacent appointments do not collide", async () => {
  const db = await freshDb();
  insertLocks(db, capacitySlots({
    organizationId: 1, equipmentId: "ct", date: "2026-08-10",
    startTime: "08:30", durationMinutes: 30, bookingCode: "RD-260810-001",
  }));
  assert.doesNotThrow(() => insertLocks(db, capacitySlots({
    organizationId: 1, equipmentId: "ct", date: "2026-08-10",
    startTime: "09:00", durationMinutes: 30, bookingCode: "RD-260810-002",
  })));
});

test("overlapping appointments are rejected by database capacity", async () => {
  const db = await freshDb();
  insertLocks(db, capacitySlots({
    organizationId: 1, equipmentId: "ct", date: "2026-08-10",
    startTime: "08:30", durationMinutes: 30, bookingCode: "RD-260810-001",
  }));
  assert.throws(() => insertLocks(db, capacitySlots({
    organizationId: 1, equipmentId: "ct", date: "2026-08-10",
    startTime: "08:45", durationMinutes: 30, bookingCode: "RD-260810-002",
  })), /booking capacity conflict|UNIQUE constraint failed/);
});

test("same clock time on different equipment or tenant is independent", async () => {
  const db = await freshDb();
  insertLocks(db, capacitySlots({
    organizationId: 1, equipmentId: "ct", date: "2026-08-10",
    startTime: "08:30", durationMinutes: 30, bookingCode: "RD-260810-001",
  }));
  assert.doesNotThrow(() => insertLocks(db, capacitySlots({
    organizationId: 1, equipmentId: "xray", date: "2026-08-10",
    startTime: "08:30", durationMinutes: 30, bookingCode: "RD-260810-002",
  })));
  assert.doesNotThrow(() => insertLocks(db, capacitySlots({
    organizationId: 2, equipmentId: "ct", date: "2026-08-10",
    startTime: "08:30", durationMinutes: 30, bookingCode: "RD-260810-003",
  })));
});

test("booking INSERT trigger reserves capacity for staff and any other write path", async () => {
  const db = await freshDb();
  insertBooking(db, { code: "RD-T1", time: "08:30" });
  const count = db.prepare("SELECT count(*) AS n FROM booking_capacity_locks WHERE booking_code = ?").get("RD-T1");
  assert.equal(count.n, 30);
  assert.throws(() => insertBooking(db, { code: "RD-T2", time: "08:45" }), /booking capacity conflict/);
  assert.doesNotThrow(() => insertBooking(db, { code: "RD-T3", time: "09:00" }));
});

test("booking UPDATE trigger atomically moves capacity and restores old locks on conflict", async () => {
  const db = await freshDb();
  insertBooking(db, { code: "RD-A", time: "08:30" });
  insertBooking(db, { code: "RD-B", time: "09:30" });
  db.prepare("UPDATE bookings SET desired_time = '09:00', status = 'rescheduled' WHERE code = 'RD-A'").run();
  assert.equal(db.prepare("SELECT count(*) AS n FROM booking_capacity_locks WHERE booking_code='RD-A' AND minute='09:00'").get().n, 1);
  assert.throws(
    () => db.prepare("UPDATE bookings SET desired_time = '09:15', status = 'rescheduled' WHERE code = 'RD-A'").run(),
    /booking capacity conflict/,
  );
  assert.equal(db.prepare("SELECT desired_time AS t FROM bookings WHERE code='RD-A'").get().t, "09:00");
  assert.equal(db.prepare("SELECT count(*) AS n FROM booking_capacity_locks WHERE booking_code='RD-A' AND minute='09:00'").get().n, 1);
});

test("cancelled and completed bookings release capacity automatically", async () => {
  const db = await freshDb();
  insertBooking(db, { code: "RD-C", time: "10:00" });
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE code='RD-C'").run();
  assert.equal(db.prepare("SELECT count(*) AS n FROM booking_capacity_locks WHERE booking_code='RD-C'").get().n, 0);
  assert.doesNotThrow(() => insertBooking(db, { code: "RD-D", time: "10:00" }));
  db.prepare("UPDATE bookings SET status = 'completed' WHERE code='RD-D'").run();
  assert.equal(db.prepare("SELECT count(*) AS n FROM booking_capacity_locks WHERE booking_code='RD-D'").get().n, 0);
});

test("same-booking explicit capacity reservation is idempotent", async () => {
  const db = await freshDb();
  insertBooking(db, { code: "RD-I", time: "11:00" });
  assert.doesNotThrow(() => insertLocks(db, capacitySlots({
    organizationId: 1, equipmentId: "ct", date: "2026-08-10",
    startTime: "11:00", durationMinutes: 30, bookingCode: "RD-I",
  })));
  assert.equal(db.prepare("SELECT count(*) AS n FROM booking_capacity_locks WHERE booking_code='RD-I'").get().n, 30);
});

test("public booking uses one D1 batch and maps capacity races to 409", async () => {
  const route = await readFile(new URL("../app/api/site-booking/route.ts", import.meta.url), "utf8");
  assert.match(route, /reserveCapacityStatements\(db/);
  assert.match(route, /await db\.batch\(statements\)/);
  assert.match(route, /isCapacityConflict\(error\)/);
  assert.match(route, /status: 409/);
  assert.match(route, /const PUBLIC_ORGANIZATION_ID = 1/);
  assert.doesNotMatch(route, /organizationId\s*=\s*clean\(body\./);
});

test("shared helper owns explicit lock primitives for batched workflows", async () => {
  const helper = await readFile(new URL("../lib/booking-capacity.ts", import.meta.url), "utf8");
  assert.match(helper, /INSERT INTO booking_capacity_locks/);
  assert.match(helper, /export function reserveCapacityStatements/);
  assert.match(helper, /export function releaseCapacityStatement/);
  assert.match(helper, /export function replaceCapacityStatements/);
  assert.match(helper, /booking capacity conflict/);
});
