import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { withD1, jsonRequest, callWorker, seedStaffSession } from "./helpers/d1.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function org2Admin(db) {
  await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'integrations-two', 'Integrations Two', 1)").run();
  return seedStaffSession(db, { email: "integrations-admin@example.com", role: "admin", organizationId: 2 });
}

test("staff integration settings are isolated from legacy org1 keys", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO app_settings (key, value) VALUES ('sms_gateway_url', 'https://sms-org1.example')").run();
    const cookie = await org2Admin(db);
    const response = await callWorker(jsonRequest("/api/staff/settings", {
      smsGatewayUrl: "https://sms-org2.example",
      remindersEnabled: true,
    }, { method: "PUT", headers: { cookie } }), db, {
      OUTBOUND_ALLOWED_HOSTS: "sms-org2.example",
    });
    assert.equal(response.status, 200);

    const legacy = await db.prepare("SELECT value FROM app_settings WHERE key = 'sms_gateway_url'").first("value");
    const scoped = await db.prepare("SELECT value FROM app_settings WHERE key = 'sms_gateway_url:org:2'").first("value");
    assert.equal(legacy, "https://sms-org1.example");
    assert.equal(scoped, "https://sms-org2.example");

    const get = await callWorker(new Request("http://localhost/api/staff/settings", { headers: { cookie } }), db);
    assert.equal(get.status, 200);
    const payload = await get.json();
    assert.equal(payload.settings.smsGatewayUrl, "https://sms-org2.example");
  });
});

test("Telegram webhook validates the secret in the URL tenant", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'tg-two', 'TG Two', 1)").run();
    await db.prepare("INSERT INTO app_settings (key, value) VALUES ('telegram_webhook_secret:org:2', 'secret-two')").run();
    const ok = await callWorker(new Request("http://localhost/api/telegram/webhook?org=2", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "secret-two" },
      body: "{}",
    }), db);
    assert.equal(ok.status, 200);

    const wrongTenant = await callWorker(new Request("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "secret-two" },
      body: "{}",
    }), db);
    assert.equal(wrongTenant.status, 401);
  });
});

test("WhatsApp admin URL and webhook token are tenant-routed", async () => {
  await withD1(async (db) => {
    const cookie = await org2Admin(db);
    const settings = await callWorker(new Request("http://localhost/api/staff/whatsapp", { headers: { cookie } }), db);
    assert.equal(settings.status, 200);
    const payload = await settings.json();
    const webhook = new URL(payload.settings.webhookUrl);
    assert.equal(webhook.searchParams.get("org"), "2");
    const token = webhook.searchParams.get("token");
    assert.ok(token);

    const ok = await callWorker(new Request(`http://localhost/api/whatsapp/webhook?org=2&token=${token}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }), db);
    assert.equal(ok.status, 200);

    const wrongTenant = await callWorker(new Request(`http://localhost/api/whatsapp/webhook?token=${token}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }), db);
    assert.equal(wrongTenant.status, 401);
  });
});

test("provider resolver and cron use tenant runtime", async () => {
  const providers = await read("lib/providers/index.ts");
  assert.match(providers, /getTenantSettings\(/);
  assert.match(providers, /FROM pacs_settings WHERE organization_id = \? LIMIT 1/);
  const reminders = await read("lib/reminders.ts");
  assert.match(reminders, /runDueRemindersForActiveOrganizations/);
  assert.match(reminders, /SELECT id FROM organizations WHERE active = 1/);
  const worker = await read("worker/index.ts");
  assert.match(worker, /runDueRemindersForActiveOrganizations\(env\.DB, Date\.now\(\)\)/);
});

test("Telegram and WhatsApp webhook configuration embeds organization routing", async () => {
  const tg = await read("app/api/staff/settings/telegram-webhook/route.ts");
  assert.match(tg, /searchParams\.set\("org", String\(orgId\)\)/);
  assert.match(tg, /setTelegramWebhook\(db, webhookUrl\.toString\(\), secret, orgId\)/);
  const wa = await read("app/api/staff/whatsapp/route.ts");
  assert.match(wa, /searchParams\.set\("org", String\(organizationId\)\)/);
  assert.match(wa, /setTenantSetting\(db, "whatsapp_enabled"/);
});
