import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";
import { sanitizeSchedule, scheduleKey, SCHEDULE_KEY } from "../lib/schedule.ts";

async function addOrganization(db, id, slug) {
  await db.prepare(
    "INSERT INTO organizations (id, slug, name, active) VALUES (?, ?, ?, 1)"
  ).bind(id, slug, `Organization ${id}`).run();
}

async function setRawSetting(db, key, value) {
  await db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, value).run();
}

const scheduleWithCtStart = (start, end = "17:00") => sanitizeSchedule({
  equipment: {
    ct: { start, end, slotMinutes: 30, breakStart: "", breakEnd: "" },
  },
});

test("schedule admin stores per-tenant config, scopes people, and preserves org1 legacy settings", async () => {
  await withD1(async (db) => {
    await addOrganization(db, 2, "other-clinic");
    const admin1 = await seedStaffSession(db, {
      email: "schedule-one@example.com", role: "admin", organizationId: 1,
    });
    const admin2 = await seedStaffSession(db, {
      email: "schedule-two@example.com", role: "admin", organizationId: 2,
    });
    await seedStaffSession(db, {
      email: "org1-rad@example.com", role: "radiologist", organizationId: 1,
    });
    await seedStaffSession(db, {
      email: "org2-rad@example.com", role: "radiologist", organizationId: 2,
    });

    const legacy = scheduleWithCtStart("08:00");
    await setRawSetting(db, SCHEDULE_KEY, JSON.stringify(legacy));
    const org2Schedule = scheduleWithCtStart("11:00", "13:00");

    const put = await callWorker(jsonRequest("/api/staff/schedule", { schedule: org2Schedule }, {
      method: "PUT", headers: { cookie: admin2 },
    }), db);
    assert.equal(put.status, 200);

    const storedOrg2 = await db.prepare("SELECT value FROM app_settings WHERE key = ?")
      .bind(scheduleKey(2)).first();
    assert.ok(storedOrg2?.value);
    const legacyAfter = await db.prepare("SELECT value FROM app_settings WHERE key = ?")
      .bind(SCHEDULE_KEY).first();
    assert.deepEqual(JSON.parse(legacyAfter.value), legacy);

    const get2 = await callWorker(jsonRequest("/api/staff/schedule", undefined, {
      method: "GET", headers: { cookie: admin2 },
    }), db);
    assert.equal(get2.status, 200);
    const body2 = await get2.json();
    assert.equal(body2.schedule.equipment.ct.start, "11:00");
    assert.equal(body2.people.some((row) => row.email === "org2-rad@example.com"), true);
    assert.equal(body2.people.some((row) => row.email === "org1-rad@example.com"), false);

    const get1 = await callWorker(jsonRequest("/api/staff/schedule", undefined, {
      method: "GET", headers: { cookie: admin1 },
    }), db);
    const body1 = await get1.json();
    assert.equal(body1.schedule.equipment.ct.start, "08:00");
  });
});

test("staff availability uses its tenant schedule while anonymous availability stays on org1", async () => {
  await withD1(async (db) => {
    await addOrganization(db, 2, "availability-clinic");
    const staff2 = await seedStaffSession(db, {
      email: "availability-two@example.com", role: "admin", organizationId: 2,
    });
    await setRawSetting(db, SCHEDULE_KEY, JSON.stringify(scheduleWithCtStart("08:00")));
    await setRawSetting(db, scheduleKey(2), JSON.stringify(scheduleWithCtStart("11:00")));

    // A future, bookable weekday (Sunday is closed in the schedule and rejected by
    // isBookableDate). A hardcoded date silently becomes "in the past" and returns
    // no slots once the wall clock moves past it.
    const target = new Date(Date.now() + 7 * 86400000);
    if (target.getUTCDay() === 0) target.setUTCDate(target.getUTCDate() + 1);
    const date = target.toISOString().slice(0, 10);
    const url = `/api/availability?date=${date}&serviceCode=403`;
    const staffResponse = await callWorker(jsonRequest(url, undefined, {
      method: "GET", headers: { cookie: staff2 },
    }), db);
    const publicResponse = await callWorker(jsonRequest(url, undefined, { method: "GET" }), db);
    assert.equal(staffResponse.status, 200);
    assert.equal(publicResponse.status, 200);
    const staffBody = await staffResponse.json();
    const publicBody = await publicResponse.json();
    assert.equal(staffBody.times[0], "11:00");
    assert.equal(publicBody.times[0], "08:00");
  });
});
