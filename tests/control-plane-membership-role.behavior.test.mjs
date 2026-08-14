import assert from "node:assert/strict";
import test from "node:test";
import { callWorker, jsonRequest, seedStaffSession, withD1 } from "./helpers/d1.mjs";

async function setMembershipRole(db, email, role, organizationId = 1) {
  await db.prepare(
    "UPDATE memberships SET role = ?, active = 1 WHERE organization_id = ? AND member_email = ?"
  ).bind(role, organizationId, email).run();
}

const protectedRequests = () => [
  jsonRequest("/api/staff/settings", undefined, { method:"GET" }),
  jsonRequest("/api/staff/settings", { remindersEnabled:true }, { method:"PUT" }),
  jsonRequest("/api/staff/settings/messaging-test", { channel:"sms", to:"+380501112233" }),
  jsonRequest("/api/staff/settings/telegram-test", {}),
  jsonRequest("/api/staff/settings/telegram-webhook", {}),
  jsonRequest("/api/staff/whatsapp", undefined, { method:"GET" }),
  jsonRequest("/api/staff/whatsapp", { idInstance:"123", apiToken:"secret", enabled:true }, { method:"PUT" }),
  jsonRequest("/api/staff/whatsapp/test", { phone:"+380501112233" }),
];

test("stale global admin cannot use integration control plane after membership downgrade", async () => {
  await withD1(async (db) => {
    const email = "stale-admin@example.com";
    const cookie = await seedStaffSession(db, { email, role:"admin" });
    await setMembershipRole(db, email, "radiologist");

    for (const request of protectedRequests()) {
      request.headers.set("cookie", cookie);
      const response = await callWorker(request, db);
      assert.equal(response.status, 403, `${request.method} ${new URL(request.url).pathname} must use membership role`);
    }

    const reminders = await db.prepare(
      "SELECT value FROM app_settings WHERE key = 'patient_reminders_enabled'"
    ).first();
    assert.ok(!reminders || reminders.value !== "1", "denied settings PUT must not mutate config");
    const whatsapp = await db.prepare(
      "SELECT value FROM app_settings WHERE key = 'whatsapp_id_instance'"
    ).first();
    assert.ok(!whatsapp || whatsapp.value !== "123", "denied WhatsApp PUT must not mutate config");
  });
});

test("membership admin remains authoritative for the primary organization even when global staff role is non-admin", async () => {
  await withD1(async (db) => {
    const email = "membership-admin@example.com";
    const cookie = await seedStaffSession(db, { email, role:"radiologist" });
    await setMembershipRole(db, email, "admin");

    const request = jsonRequest("/api/staff/settings", undefined, { method:"GET", headers:{ cookie } });
    const response = await callWorker(request, db);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.staff.email, email);
    assert.equal(body.staff.role, "admin");
  });
});

test("secondary tenant admin cannot administer legacy-global integration settings", async () => {
  await withD1(async (db) => {
    await db.prepare("INSERT INTO organizations (id, slug, name, active) VALUES (2, 'control-two', 'Control Two', 1)").run();
    const email = "org2-admin@example.com";
    const cookie = await seedStaffSession(db, { email, role:"admin", organizationId:2 });

    for (const request of protectedRequests()) {
      request.headers.set("cookie", cookie);
      const response = await callWorker(request, db);
      assert.equal(response.status, 403, `${request.method} ${new URL(request.url).pathname} must fail closed outside org 1`);
    }

    const reminders = await db.prepare(
      "SELECT value FROM app_settings WHERE key = 'patient_reminders_enabled'"
    ).first();
    assert.ok(!reminders || reminders.value !== "1");
    const whatsapp = await db.prepare(
      "SELECT value FROM app_settings WHERE key = 'whatsapp_id_instance'"
    ).first();
    assert.ok(!whatsapp || whatsapp.value !== "123");
  });
});

test("integration control-plane routes derive authorization from tenant membership and fail closed outside the primary tenant", async () => {
  const { readFile } = await import("node:fs/promises");
  const paths = [
    "../app/api/staff/settings/route.ts",
    "../app/api/staff/settings/messaging-test/route.ts",
    "../app/api/staff/settings/telegram-test/route.ts",
    "../app/api/staff/settings/telegram-webhook/route.ts",
    "../app/api/staff/whatsapp/route.ts",
    "../app/api/staff/whatsapp/test/route.ts",
  ];
  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /requireOrgContext\(request, db\)/, path);
    assert.doesNotMatch(source, /requireStaff\(request, db\)/, path);
    assert.match(source, /PRIMARY_ORGANIZATION_ID = 1/, path);
    assert.match(source, /ctx\.organizationId !== PRIMARY_ORGANIZATION_ID/, path);
  }

  const settings = await readFile(new URL("../app/api/staff/settings/route.ts", import.meta.url), "utf8");
  assert.match(settings, /organizationId: ctx\.organizationId/);
  assert.doesNotMatch(settings, /organizationId: 1/);
});
