import assert from "node:assert/strict";
import test from "node:test";

import { assignEarliestAppointments } from "../lib/auto-booking.ts";
import { SCHEDULE_DEFAULTS } from "../lib/schedule.ts";

const service = (code, equipmentId, durationMinutes) => ({
  code,
  title: `Послуга ${code}`,
  description: "",
  price: 0,
  ehealthCode: "",
  equipmentId,
  durationMinutes,
  group: "Тест",
});

test("public request receives the earliest real free room slot", () => {
  const result = assignEarliestAppointments({
    services: [service("401", "ct", 30)],
    schedule: SCHEDULE_DEFAULTS,
    bookings: [{ equipmentId: "ct", date: "2026-08-03", startTime: "08:00", durationMinutes: 30 }],
    blocks: [],
    fromDate: "2026-08-03",
    fromTime: "07:00",
  });
  assert.equal(result?.[0].date, "2026-08-03");
  assert.equal(result?.[0].time, "08:30");
});

test("several services in one request cannot overlap in the same room", () => {
  const result = assignEarliestAppointments({
    services: [service("401", "ct", 30), service("402", "ct", 30)],
    schedule: SCHEDULE_DEFAULTS,
    bookings: [],
    blocks: [],
    fromDate: "2026-08-03",
    fromTime: "07:00",
  });
  assert.deepEqual(result?.map((item) => item.time), ["08:00", "08:30"]);
});

test("closed days and equipment blocks are skipped", () => {
  const result = assignEarliestAppointments({
    services: [service("101", "fluoro", 15)],
    schedule: SCHEDULE_DEFAULTS,
    bookings: [],
    blocks: [{ equipmentId: "fluoro", date: "2026-08-03", startTime: "09:30", endTime: "10:00" }],
    fromDate: "2026-08-02",
    fromTime: "07:00",
  });
  assert.equal(result?.[0].date, "2026-08-03");
  assert.equal(result?.[0].time, "10:00");
});

test("a patient-picked slot is honoured over the earliest free time", () => {
  const result = assignEarliestAppointments({
    services: [service("401", "ct", 30)],
    schedule: SCHEDULE_DEFAULTS,
    bookings: [],
    blocks: [],
    fromDate: "2026-08-03",
    fromTime: "07:00",
    preferredDate: "2026-08-05",
    preferredTime: "10:00",
  });
  // Earliest would be 2026-08-03 08:00; the chosen slot must win instead.
  assert.equal(result?.[0].date, "2026-08-05");
  assert.equal(result?.[0].time, "10:00");
});

test("a preferred slot taken by someone else falls back to the earliest that day", () => {
  const result = assignEarliestAppointments({
    services: [service("401", "ct", 30)],
    schedule: SCHEDULE_DEFAULTS,
    bookings: [{ equipmentId: "ct", date: "2026-08-05", startTime: "10:00", durationMinutes: 30 }],
    blocks: [],
    fromDate: "2026-08-03",
    fromTime: "07:00",
    preferredDate: "2026-08-05",
    preferredTime: "10:00",
  });
  // Chosen time is busy → still keep the chosen day, earliest free slot on it.
  assert.equal(result?.[0].date, "2026-08-05");
  assert.equal(result?.[0].time, "08:00");
});

test("a preferred date in the past is ignored (earliest wins)", () => {
  const result = assignEarliestAppointments({
    services: [service("401", "ct", 30)],
    schedule: SCHEDULE_DEFAULTS,
    bookings: [],
    blocks: [],
    fromDate: "2026-08-04",
    fromTime: "07:00",
    preferredDate: "2026-08-03", // before fromDate → not a valid preference
    preferredTime: "10:00",
  });
  assert.equal(result?.[0].date, "2026-08-04");
  assert.equal(result?.[0].time, "08:00");
});

test("an off-grid preferred time falls back to the earliest slot on the chosen day", () => {
  const result = assignEarliestAppointments({
    services: [service("401", "ct", 30)],
    schedule: SCHEDULE_DEFAULTS,
    bookings: [],
    blocks: [],
    fromDate: "2026-08-03",
    fromTime: "07:00",
    preferredDate: "2026-08-05",
    preferredTime: "10:07", // not a real slot start
  });
  assert.equal(result?.[0].date, "2026-08-05");
  assert.equal(result?.[0].time, "08:00");
});
