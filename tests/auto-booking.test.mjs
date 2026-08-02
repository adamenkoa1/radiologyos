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
