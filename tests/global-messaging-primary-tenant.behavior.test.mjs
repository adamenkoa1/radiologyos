import assert from "node:assert/strict";
import test from "node:test";
import {
  callWorker,
  jsonRequest,
  seedPatientSession,
  seedStaffSession,
  withD1,
} from "./helpers/d1.mjs";

async function addOrganizationTwo(db) {
  await db.prepare(
    "INSERT INTO organizations (id, slug, name, active) VALUES (2, 'messaging-two', 'Messaging Two', 1)"
  ).run();
}

async function setGlobal(db, key, value) {
  await db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, value).run();
}

async function addBooking(db, {
  id,
  organizationId,
  code,
  phone = "380501112233",
  email = "",
  date = "2026-09-01",
  time = "10:00",
}) {
  await db.prepare(
    `INSERT INTO bookings
      (id, organization_id, code, name, phone, phone_normalized, patient_email,
       service, service_code, desired_date, desired_time, status, date_of_birth, patient_category)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'КТ', 'CT-01', ?, ?, 'confirmed', '1990-05-05', 'civilian')`
  ).bind(id, organizationId, code, `Patient ${code}`, `+${phone}`, phone, email, date, time).run();
}

test("secondary tenant manual notify never uses primary global gateways", async () => {
  await withD1(async (db) => {
    await addOrganizationTwo(db);
    await addBooking(db, { id:201, organizationId:2, code:"MSG-ORG2" });
    await setGlobal(db, "sms_gateway_url", "https://gateway.example/sms");
    await setGlobal(db, "sms_gateway_auth", "org1-secret");
    await setGlobal(db, "email_gateway_url", "https://gateway.example/email");
    await setGlobal(db, "telegram_bot_token", "123456:abcdefghijklmnopqrstuvwxyzABCDE");
    await setGlobal(db, "whatsapp_id_instance", "org1-instance");
    await setGlobal(db, "whatsapp_api_token_instance", "org1-token");
    await setGlobal(db, "whatsapp_enabled", "1");

    const cookie = await seedStaffSession(db, {
      email:"org2-registrar@example.com", role:"registrar", organizationId:2,
    });
    const response = await callWorker(
      jsonRequest(
        "/api/staff/notify",
        { bookingId:201, message:"Повідомлення для пацієнта" },
        { headers:{ cookie } },
      ),
      db,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.summary.sent, 0);
    assert.equal(body.summary.failed, 0);
    assert.ok(body.summary.skipped >= 1);

    const rows = await db.prepare(
      `SELECT organization_id AS organizationId, channel, status
       FROM patient_notifications WHERE booking_id = 201 ORDER BY id`
    ).all();
    assert.ok(rows.results.length >= 1);
    assert.ok(rows.results.every((row) => row.organizationId === 2));
    assert.ok(rows.results.every((row) => row.status === "skipped"));
    assert.ok(rows.results.every((row) => row.channel !== "whatsapp"));
  });
});

test("secondary tenant contact-center cannot reply through primary WhatsApp", async () => {
  await withD1(async (db) => {
    await addOrganizationTwo(db);
    const phone = "380502223344";
    await addBooking(db, { id:202, organizationId:2, code:"CHAT-ORG2", phone });
    await db.prepare(
      `INSERT INTO patient_communications
        (organization_id, patient_id, phone_normalized, channel, direction, summary, actor)
       VALUES (2, '', ?, 'whatsapp', 'inbound', 'Org2 legacy thread', 'system')`
    ).bind(phone).run();
    await setGlobal(db, "whatsapp_id_instance", "org1-instance");
    await setGlobal(db, "whatsapp_api_token_instance", "org1-token");
    await setGlobal(db, "whatsapp_enabled", "1");

    const cookie = await seedStaffSession(db, {
      email:"org2-chat@example.com", role:"registrar", organizationId:2,
    });
    const thread = await callWorker(
      jsonRequest(`/api/staff/chat?phone=${phone}`, undefined, { method:"GET", headers:{ cookie } }),
      db,
    );
    assert.equal(thread.status, 200);
    assert.deepEqual((await thread.json()).availableReplyChannels, []);

    const reply = await callWorker(
      jsonRequest(
        "/api/staff/chat",
        { phone:`+${phone}`, text:"Не використовуйте org1 gateway", channel:"whatsapp" },
        { headers:{ cookie } },
      ),
      db,
    );
    assert.equal(reply.status, 403);
    const outbound = await db.prepare(
      `SELECT COUNT(*) AS n FROM patient_communications
       WHERE organization_id = 2 AND phone_normalized = ? AND direction = 'outbound'`
    ).bind(phone).first("n");
    assert.equal(outbound, 0);
  });
});

test("secondary tenant patient cannot receive a deep-link to the primary Telegram bot", async () => {
  await withD1(async (db) => {
    await addOrganizationTwo(db);
    const phone = "380503334455";
    await addBooking(db, { id:203, organizationId:2, code:"TG-ORG2", phone });
    await setGlobal(db, "telegram_bot_token", "123456:abcdefghijklmnopqrstuvwxyzABCDE");
    const cookie = await seedPatientSession(db, phone, 2);

    const response = await callWorker(
      jsonRequest("/api/my-telegram-link", {}, { headers:{ cookie } }),
      db,
    );
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.botConfigured, false);
    const tokens = await db.prepare(
      "SELECT COUNT(*) AS n FROM telegram_link_tokens WHERE organization_id = 2"
    ).first("n");
    assert.equal(tokens, 0);
  });
});

test("provider diagnostics hide primary SMS/email capabilities from secondary tenant", async () => {
  await withD1(async (db) => {
    await addOrganizationTwo(db);
    await setGlobal(db, "sms_gateway_url", "https://gateway.example/sms");
    await setGlobal(db, "email_gateway_url", "https://gateway.example/email");

    const org2Cookie = await seedStaffSession(db, {
      email:"org2-provider@example.com", role:"admin", organizationId:2,
    });
    const org2 = await callWorker(
      jsonRequest("/api/staff/providers", undefined, { method:"GET", headers:{ cookie:org2Cookie } }),
      db,
    );
    assert.equal(org2.status, 200);
    const org2Body = await org2.json();
    assert.equal(org2Body.providers.messaging.sms, false);
    assert.equal(org2Body.providers.messaging.email, false);

    const org1Cookie = await seedStaffSession(db, {
      email:"org1-provider@example.com", role:"admin", organizationId:1,
    });
    const org1 = await callWorker(
      jsonRequest("/api/staff/providers", undefined, { method:"GET", headers:{ cookie:org1Cookie } }),
      db,
    );
    assert.equal(org1.status, 200);
    const org1Body = await org1.json();
    assert.equal(org1Body.providers.messaging.sms, true);
    assert.equal(org1Body.providers.messaging.email, true);
  });
});

test("global WhatsApp webhook writes and looks up only primary-tenant data", async () => {
  await withD1(async (db) => {
    await addOrganizationTwo(db);
    const phone = "380504445566";
    await addBooking(db, { id:204, organizationId:1, code:"WA-ORG1", phone, time:"09:00" });
    await addBooking(db, { id:205, organizationId:2, code:"WA-ORG2", phone, time:"11:00" });
    await setGlobal(db, "whatsapp_webhook_token", "webhook-secret");

    const response = await callWorker(
      jsonRequest(
        "/api/whatsapp/webhook",
        {
          typeWebhook:"incomingMessageReceived",
          idMessage:"MSG-PRIMARY-SCOPE",
          senderData:{ chatId:`${phone}@c.us`, senderName:"Patient" },
          messageData:{ typeMessage:"textMessage", textMessageData:{ textMessage:"невідома команда" } },
        },
        { headers:{ "x-webhook-token":"webhook-secret" } },
      ),
      db,
    );
    assert.equal(response.status, 200);

    const rows = await db.prepare(
      `SELECT organization_id AS organizationId, external_id AS externalId
       FROM patient_communications WHERE external_id = 'MSG-PRIMARY-SCOPE'`
    ).all();
    assert.equal(rows.results.length, 1);
    assert.equal(rows.results[0].organizationId, 1);
  });
});

test("WhatsApp webhook source scopes appointment lookup and communication inserts to org 1", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/api/whatsapp/webhook/route.ts", import.meta.url), "utf8");
  assert.match(source, /PRIMARY_ORGANIZATION_ID = 1/);
  assert.match(source, /WHERE organization_id = \? AND phone_normalized = \?/);
  assert.match(source, /\.bind\(PRIMARY_ORGANIZATION_ID, phone, todayKyiv\(\)\)/);
  assert.match(source, /\(organization_id, phone_normalized, channel, direction, summary, actor, external_id\)/);
  assert.doesNotMatch(source, /INSERT OR IGNORE INTO patient_communications \(phone_normalized/);
});