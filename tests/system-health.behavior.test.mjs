import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, seedStaffSession, withD1 } from "./helpers/d1.mjs";

function request(cookie) {
  return new Request("http://localhost/api/staff/system/health", { headers:{ cookie } });
}

test("system health is admin-only and returns no PHI or integration secrets", async () => {
  await withD1(async (db) => {
    const adminCookie = await seedStaffSession(db, { email:"admin@system-health.test", role:"admin" });
    const staffCookie = await seedStaffSession(db, { email:"staff@system-health.test", role:"doctor" });

    await db.prepare(
      `UPDATE pacs_settings SET dicomweb_base_url = ?, enabled = 1 WHERE organization_id = 1`,
    ).bind("https://secret-pacs.example.test/dicomweb").run();
    await db.prepare(
      `INSERT INTO mwl_bridge_tokens
        (organization_id, token_hash, active, created_by, created_at, last_used_at)
       VALUES (1, 'secret-mwl-hash', 1, 'admin@system-health.test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).run();

    const denied = await callWorker(request(staffCookie), db);
    assert.equal(denied.status, 403);

    const response = await callWorker(request(adminCookie), db);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.checks.database.state, "operational");
    assert.equal(body.checks.authentication.state, "operational");
    assert.equal(body.checks.bookings.state, "operational");
    assert.equal(body.checks.payments.state, "operational");
    assert.equal(body.imaging.pacsConfigured, true);
    assert.equal(body.imaging.pacsEnabled, true);
    assert.equal(body.imaging.mwlActive, true);

    const serialized = JSON.stringify(body);
    for (const forbidden of [
      "secret-pacs.example.test",
      "secret-mwl-hash",
      "admin@system-health.test",
      "staff@system-health.test",
    ]) assert.equal(serialized.includes(forbidden), false);
  });
});

test("system health reads imaging readiness only from the signed-in tenant", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email:"tenant-admin@health.test", role:"admin" });

    await db.prepare(
      "INSERT INTO organizations (id, slug, name, active) VALUES (2, 'health-other-tenant', 'Health Other Tenant', 1)",
    ).run();
    await db.prepare(
      `UPDATE pacs_settings SET dicomweb_base_url = '', enabled = 0 WHERE organization_id = 1`,
    ).run();
    await db.prepare(
      `INSERT INTO pacs_settings
        (organization_id, dicomweb_base_url, enabled, updated_by, updated_at)
       VALUES (2, 'https://other-tenant-pacs.example.test/dicomweb', 1, 'other-admin', CURRENT_TIMESTAMP)`,
    ).run();
    await db.prepare(
      `INSERT INTO mwl_bridge_tokens
        (organization_id, token_hash, active, created_by, created_at, last_used_at)
       VALUES (2, 'other-tenant-secret-hash', 1, 'other-admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).run();

    const response = await callWorker(request(cookie), db);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.imaging.pacsConfigured, false);
    assert.equal(body.imaging.pacsEnabled, false);
    assert.equal(body.imaging.mwlConfigured, false);
    assert.equal(body.imaging.mwlActive, false);

    const serialized = JSON.stringify(body);
    for (const forbidden of [
      "other-tenant-pacs.example.test",
      "other-tenant-secret-hash",
      "other-admin",
    ]) assert.equal(serialized.includes(forbidden), false);
  });
});