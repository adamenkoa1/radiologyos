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

test("system health probes only the signed-in tenant and never returns row data", async () => {
  await withD1(async (db) => {
    const cookie = await seedStaffSession(db, { email:"tenant-admin@health.test", role:"admin" });

    await db.prepare(
      `INSERT INTO bookings
        (organization_id, code, name, phone, phone_normalized, service_code, desired_date, desired_time, status)
       VALUES (2, 'OTHER-TENANT-SECRET', 'Other Tenant Patient', '+380000000000', '+380000000000', 'ct_brain', '2026-08-11', '10:00', 'new')`,
    ).run();
    await db.prepare(
      `INSERT INTO payment_transactions
        (organization_id, booking_id, amount, currency, provider, provider_reference, status)
       VALUES (2, 999999, 100, 'UAH', 'test-provider', 'OTHER-TENANT-PAYMENT-SECRET', 'pending')`,
    ).run();

    const response = await callWorker(request(cookie), db);
    assert.equal(response.status, 200);
    const serialized = JSON.stringify(await response.json());
    for (const forbidden of [
      "OTHER-TENANT-SECRET",
      "Other Tenant Patient",
      "+380000000000",
      "OTHER-TENANT-PAYMENT-SECRET",
      "test-provider",
    ]) assert.equal(serialized.includes(forbidden), false);
  });
});
