import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

const LEGACY_KEY = "service_catalog_config_v1";
const ORG2_KEY = `${LEGACY_KEY}:org:2`;
const SERVICE_CODE = "ct-chest";

async function addOrganizationTwo(db) {
  await db.prepare(
    "INSERT INTO organizations (id, slug, name, active) VALUES (2, 'services-two', 'Services Two', 1)",
  ).run();
}

async function setSetting(db, key, value) {
  await db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).bind(key, value).run();
}

function serviceOverride(durationMinutes, active) {
  return JSON.stringify([{ code: SERVICE_CODE, durationMinutes, active }]);
}

function byCode(rows, code = SERVICE_CODE) {
  return rows.find((row) => row.code === code);
}

async function getServices(db, cookie) {
  const response = await callWorker(
    jsonRequest("/api/staff/services", undefined, { method: "GET", headers: { cookie } }),
    db,
  );
  assert.equal(response.status, 200);
  return response.json();
}

test("primary tenant keeps the legacy global service config fallback", async () => {
  await withD1(async (db) => {
    await setSetting(db, LEGACY_KEY, serviceOverride(355, false));
    const cookie = await seedStaffSession(db, {
      email: "org1-services@example.com",
      role: "admin",
      organizationId: 1,
    });

    const body = await getServices(db, cookie);
    assert.equal(byCode(body.services).durationMinutes, 355);
    assert.equal(byCode(body.services).active, false);
    assert.equal(byCode(body.effectiveServices).durationMinutes, 355);
    assert.equal(byCode(body.effectiveServices).active, false);
  });
});

test("secondary tenant without its own config never inherits the primary legacy config", async () => {
  await withD1(async (db) => {
    await addOrganizationTwo(db);
    await setSetting(db, LEGACY_KEY, serviceOverride(355, false));
    const cookie = await seedStaffSession(db, {
      email: "org2-services@example.com",
      role: "admin",
      organizationId: 2,
    });

    const body = await getServices(db, cookie);
    const raw = byCode(body.services);
    const effective = byCode(body.effectiveServices);
    assert.equal(raw.active, true);
    assert.notEqual(raw.durationMinutes, 355);
    assert.equal(effective.active, true);
    assert.notEqual(effective.durationMinutes, 355);
  });
});

test("secondary tenant uses its own service config instead of the primary legacy config", async () => {
  await withD1(async (db) => {
    await addOrganizationTwo(db);
    await setSetting(db, LEGACY_KEY, serviceOverride(355, false));
    await setSetting(db, ORG2_KEY, serviceOverride(345, false));
    const cookie = await seedStaffSession(db, {
      email: "org2-own-services@example.com",
      role: "admin",
      organizationId: 2,
    });

    const body = await getServices(db, cookie);
    assert.equal(byCode(body.services).durationMinutes, 345);
    assert.equal(byCode(body.services).active, false);
    assert.equal(byCode(body.effectiveServices).durationMinutes, 345);
    assert.equal(byCode(body.effectiveServices).active, false);
  });
});
