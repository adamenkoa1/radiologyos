import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedPatientSession, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function addOrganizationTwo(db) {
  await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'messaging-two', 'Messaging Two', 1)").run();
}
async function setGlobal(db,key,value) {
  await db.prepare(`INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(key,value).run();
}
async function setOrg(db,organizationId,key,value) {
  await db.prepare(`INSERT INTO organization_integration_settings (organization_id,key,value) VALUES (?,?,?) ON CONFLICT(organization_id,key) DO UPDATE SET value=excluded.value`).bind(organizationId,key,value).run();
}
async function addBooking(db,{id,organizationId,code,phone="380501112233",email="",date="2026-09-01",time="10:00"}) {
  await db.prepare(
    `INSERT INTO bookings
      (id, organization_id, code, name, phone, phone_normalized, patient_email,
       service, service_code, desired_date, desired_time, status, date_of_birth, patient_category)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'КТ', 'CT-01', ?, ?, 'confirmed', '1990-05-05', 'civilian')`
  ).bind(id,organizationId,code,`Patient ${code}`,`+${phone}`,phone,email,date,time).run();
}

test("secondary tenant never inherits primary global messaging gateways", async()=>{
  await withD1(async(db)=>{
    await addOrganizationTwo(db); await addBooking(db,{id:201,organizationId:2,code:"MSG-ORG2"});
    await setGlobal(db,"sms_gateway_url","https://gateway.example/sms");
    await setGlobal(db,"sms_gateway_auth","org1-secret");
    await setGlobal(db,"email_gateway_url","https://gateway.example/email");
    const cookie=await seedStaffSession(db,{email:"org2-registrar@example.com",role:"registrar",organizationId:2});
    const response=await callWorker(jsonRequest("/api/staff/notify",{bookingId:201,message:"Повідомлення"},{headers:{cookie}}),db);
    assert.equal(response.status,200); const body=await response.json();
    assert.equal(body.summary.sent,0); assert.equal(body.summary.failed,0); assert.ok(body.summary.skipped>=1);
  });
});

test("secondary provider diagnostics use only explicit tenant settings",async()=>{
  await withD1(async(db)=>{
    await addOrganizationTwo(db);
    await setGlobal(db,"sms_gateway_url","https://primary.example/sms");
    await setGlobal(db,"email_gateway_url","https://primary.example/email");
    let cookie=await seedStaffSession(db,{email:"org2-provider@example.com",role:"admin",organizationId:2});
    let response=await callWorker(jsonRequest("/api/staff/providers",undefined,{method:"GET",headers:{cookie}}),db);
    let body=await response.json(); assert.equal(body.providers.messaging.sms,false); assert.equal(body.providers.messaging.email,false);
    await setOrg(db,2,"sms_gateway_url","https://secondary.example/sms");
    await setOrg(db,2,"email_gateway_url","https://secondary.example/email");
    response=await callWorker(jsonRequest("/api/staff/providers",undefined,{method:"GET",headers:{cookie}}),db);
    body=await response.json(); assert.equal(body.providers.messaging.sms,true); assert.equal(body.providers.messaging.email,true);

    // Model a genuinely legacy-only org1: migration 0089 normally seeds scoped rows,
    // and scoped values must remain authoritative whenever they exist.
    await db.prepare(`
      DELETE FROM organization_integration_settings
      WHERE organization_id = 1
        AND key IN (
          'telegram_bot_username',
          'telegram_bot_token',
          'sms_gateway_url',
          'sms_gateway_auth',
          'email_gateway_url',
          'email_gateway_auth',
          'email_gateway_from'
        )
    `).run();
    cookie=await seedStaffSession(db,{email:"org1-provider@example.com",role:"admin",organizationId:1});
    response=await callWorker(jsonRequest("/api/staff/providers",undefined,{method:"GET",headers:{cookie}}),db);
    body=await response.json(); assert.equal(body.providers.messaging.sms,true); assert.equal(body.providers.messaging.email,true);
  });
});

test("secondary patient cannot receive primary Telegram bot link but can use its own cached bot",async()=>{
  await withD1(async(db)=>{
    await addOrganizationTwo(db); const phone="380503334455"; await addBooking(db,{id:203,organizationId:2,code:"TG-ORG2",phone});
    await setGlobal(db,"telegram_bot_token","123456:abcdefghijklmnopqrstuvwxyzABCDE");
    const cookie=await seedPatientSession(db,phone,2);
    let response=await callWorker(jsonRequest("/api/my-telegram-link",{},{headers:{cookie}}),db);
    assert.equal(response.status,503);
    await setOrg(db,2,"telegram_bot_token","654321:abcdefghijklmnopqrstuvwxyzABCDE");
    await setOrg(db,2,"telegram_bot_username","OrgTwoBot");
    response=await callWorker(jsonRequest("/api/my-telegram-link",{},{headers:{cookie}}),db);
    assert.equal(response.status,200); const body=await response.json(); assert.match(body.url,/^https:\/\/t\.me\/OrgTwoBot\?start=/);
    const tokens=await db.prepare("SELECT COUNT(*) AS n FROM telegram_link_tokens WHERE organization_id=2").first("n"); assert.equal(tokens,1);
  });
});

test("legacy WhatsApp webhook secret remains org1 compatible",async()=>{
  await withD1(async(db)=>{
    await addOrganizationTwo(db); const phone="380504445566";
    await addBooking(db,{id:204,organizationId:1,code:"WA-ORG1",phone}); await addBooking(db,{id:205,organizationId:2,code:"WA-ORG2",phone});
    await setGlobal(db,"whatsapp_webhook_token","legacy-secret");
    const response=await callWorker(jsonRequest("/api/whatsapp/webhook",{
      typeWebhook:"incomingMessageReceived",idMessage:"MSG-PRIMARY-SCOPE",senderData:{chatId:`${phone}@c.us`},
      messageData:{typeMessage:"textMessage",textMessageData:{textMessage:"невідома команда"}},
    },{headers:{"x-webhook-token":"legacy-secret"}}),db);
    assert.equal(response.status,200);
    const rows=await db.prepare("SELECT organization_id AS organizationId FROM patient_communications WHERE external_id='MSG-PRIMARY-SCOPE'").all();
    assert.equal(rows.results.length,1); assert.equal(rows.results[0].organizationId,1);
  });
});

test("tenant WhatsApp webhook routes same-phone data only to owning organization",async()=>{
  await withD1(async(db)=>{
    await addOrganizationTwo(db); const phone="380505556677";
    await addBooking(db,{id:206,organizationId:1,code:"WA1",phone}); await addBooking(db,{id:207,organizationId:2,code:"WA2",phone});
    await setOrg(db,2,"whatsapp_webhook_token","org2-secret");
    const response=await callWorker(jsonRequest("/api/whatsapp/webhook",{
      typeWebhook:"incomingMessageReceived",idMessage:"MSG-ORG2-SCOPE",senderData:{chatId:`${phone}@c.us`},
      messageData:{typeMessage:"textMessage",textMessageData:{textMessage:"невідома команда"}},
    },{headers:{"x-webhook-token":"org2-secret"}}),db);
    assert.equal(response.status,200);
    const rows=await db.prepare("SELECT organization_id AS organizationId FROM patient_communications WHERE external_id='MSG-ORG2-SCOPE'").all();
    assert.deepEqual(rows.results.map(r=>r.organizationId),[2]);
  });
});

test("duplicate tenant webhook secrets fail closed",async()=>{
  await withD1(async(db)=>{
    await addOrganizationTwo(db); await setOrg(db,1,"whatsapp_webhook_token","duplicate-secret"); await setOrg(db,2,"whatsapp_webhook_token","duplicate-secret");
    const response=await callWorker(jsonRequest("/api/whatsapp/webhook",{}, {headers:{"x-webhook-token":"duplicate-secret"}}),db);
    assert.equal(response.status,401);
  });
});

test("scoped org1 secret makes stale legacy webhook secret invalid",async()=>{
  await withD1(async(db)=>{
    await setGlobal(db,"whatsapp_webhook_token","old-secret"); await setOrg(db,1,"whatsapp_webhook_token","new-secret");
    const oldResponse=await callWorker(jsonRequest("/api/whatsapp/webhook",{}, {headers:{"x-webhook-token":"old-secret"}}),db);
    assert.equal(oldResponse.status,401);
  });
});

test("integration source has no primary-only Telegram or webhook routing guard",async()=>{
  const {readFile}=await import("node:fs/promises");
  const telegram=await readFile(new URL("../app/api/my-telegram-link/route.ts",import.meta.url),"utf8");
  const whatsappWebhook=await readFile(new URL("../app/api/whatsapp/webhook/route.ts",import.meta.url),"utf8");
  assert.doesNotMatch(telegram,/session\.organizationId !== PRIMARY_ORGANIZATION_ID/);
  assert.match(telegram,/telegramBotUsername\(db, session\.organizationId\)/);
  assert.match(whatsappWebhook,/resolveOrganizationByIntegrationSecret/);
  assert.match(whatsappWebhook,/\.bind\(organizationId,phone,todayKyiv\(\)\)/);
  assert.doesNotMatch(whatsappWebhook,/PRIMARY_ORGANIZATION_ID = 1/);
});
