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

test("overlapping appointments are rejected by database uniqueness", async () => {
  const db = await freshDb();
  insertLocks(db, capacitySlots({
    organizationId: 1, equipmentId: "ct", date: "2026-08-10",
    startTime: "08:30", durationMinutes: 30, bookingCode: "RD-260810-001",
  }));
  assert.throws(() => insertLocks(db, capacitySlots({
    organizationId: 1, equipmentId: "ct", date: "2026-08-10",
    startTime: "08:45", durationMinutes: 30, bookingCode: "RD-260810-002",
  })), /UNIQUE constraint failed/);
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

test("public booking writes locks in the same D1 batch and maps races to 409", async () => {
  const route = await readFile(new URL("../app/api/site-booking/route.ts", import.meta.url), "utf8");
  assert.match(route, /reserveCapacityStatements\(db/);
  assert.match(route, /await db\.batch\(statements\)/);
  assert.match(route, /isCapacityConflict\(error\)/);
  assert.match(route, /status: 409/);
});

test("shared helper owns the lock SQL and exposes reserve, release and replace primitives", async () => {
  const helper = await readFile(new URL("../lib/booking-capacity.ts", import.meta.url), "utf8");
  assert.match(helper, /INSERT INTO booking_capacity_locks/);
  assert.match(helper, /export function reserveCapacityStatements/);
  assert.match(helper, /export function releaseCapacityStatement/);
  assert.match(helper, /export function replaceCapacityStatements/);
});
