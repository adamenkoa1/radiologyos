import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

test("secondary tenant cannot resolve or read the primary tenant external calendar", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'calendar-two', 'Calendar Two', 1)").run();
    await db.prepare(
      `INSERT INTO app_settings (key, value) VALUES ('external_ics_url', 'https://calendar.example/private.ics')
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).run();

    const registrarCookie = await seedStaffSession(db, {
      email:"calendar-reg2@example.com", role:"registrar", organizationId:2,
    });
    const feed = await callWorker(
      jsonRequest("/api/staff/external-calendar", undefined, { method:"GET", headers:{ cookie:registrarCookie } }),
      db,
    );
    assert.equal(feed.status, 200);
    assert.deepEqual(await feed.json(), { configured:false, events:[] });

    const adminCookie = await seedStaffSession(db, {
      email:"calendar-admin2@example.com", role:"admin", organizationId:2,
    });
    const status = await callWorker(
      jsonRequest("/api/staff/providers", undefined, { method:"GET", headers:{ cookie:adminCookie } }),
      db,
    );
    assert.equal(status.status, 200);
    const body = await status.json();
    assert.equal(body.organization.id, 2);
    assert.equal(body.providers.calendar.name, "none");
    assert.equal(body.providers.calendar.configured, false);
  });
});

test("primary tenant provider diagnostics still see the configured external calendar", async () => {
  await withD1(async (db) => {
    await db.prepare(
      `INSERT INTO app_settings (key, value) VALUES ('external_ics_url', 'https://calendar.example/private.ics')
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    ).run();
    const cookie = await seedStaffSession(db, { email:"calendar-admin1@example.com", role:"admin" });
    const response = await callWorker(
      jsonRequest("/api/staff/providers", undefined, { method:"GET", headers:{ cookie } }),
      db,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.providers.calendar.name, "ics");
    assert.equal(body.providers.calendar.configured, true);
  });
});

test("provider resolver fails closed for legacy-global calendar URL outside org 1", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../lib/providers/index.ts", import.meta.url), "utf8");
  assert.match(source, /PRIMARY_ORGANIZATION_ID = 1/);
  assert.match(source, /ctx\.organizationId === PRIMARY_ORGANIZATION_ID/);
  assert.match(source, /getSettings\(db, \["external_ics_url"\]\)/);
  assert.match(source, /: Promise\.resolve\(""\)/);
});
