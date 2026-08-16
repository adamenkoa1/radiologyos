import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function freshDb() {
  const dir = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const db = new DatabaseSync(":memory:");
  for (const file of files) {
    const sql = await readFile(new URL(file, dir), "utf8");
    for (const statement of sql.split(/-->\s*statement-breakpoint/).map((value) => value.trim()).filter(Boolean)) {
      db.exec(statement);
    }
  }
  return db;
}

test("contact-center communication history stays tenant scoped across channels", async () => {
  const db = await freshDb();
  db.exec("INSERT OR IGNORE INTO organizations (id, name, slug, active) VALUES (2, 'Org 2', 'org-2', 1)");
  const insert = db.prepare(
    `INSERT INTO patient_communications (organization_id, phone_normalized, channel, direction, summary, actor)
     VALUES (?,?,?,?,?,?)`,
  );
  insert.run(1, "380971111111", "whatsapp", "inbound", "Org1 WhatsApp", "patient");
  insert.run(1, "380971111111", "telegram", "outbound", "Org1 Telegram", "system");
  insert.run(2, "380972222222", "whatsapp", "inbound", "Org2 WhatsApp", "patient");

  const allOrg1 = db.prepare(
    "SELECT channel, summary FROM patient_communications WHERE phone_normalized = ? AND organization_id = ? ORDER BY id",
  ).all("380971111111", 1);
  assert.deepEqual(allOrg1.map((row) => row.channel), ["whatsapp", "telegram"]);
  assert.equal(allOrg1.some((row) => row.summary === "Org2 WhatsApp"), false);

  const telegramOnly = db.prepare(
    "SELECT summary FROM patient_communications WHERE phone_normalized = ? AND organization_id = ? AND channel = ?",
  ).all("380971111111", 1, "telegram");
  assert.deepEqual(telegramOnly.map((row) => row.summary), ["Org1 Telegram"]);
});

test("contact-center route derives tenant, preserves exact ids, and fails closed on ambiguous compatibility reads", async () => {
  const route = await read("app/api/staff/chat/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /patient_communications[\s\S]*organization_id = \?/);
  assert.match(route, /patient_id AS patientId/);
  assert.match(route, /resolvePhoneCompatibilityScope/);
  assert.match(route, /if \(scope\.ambiguous\)/);
  assert.match(route, /WHERE organization_id = \? AND patient_id = \? LIMIT 1/);
  assert.match(route, /if \(!profile\)[\s\S]*status:404/);
  assert.match(route, /exactProfileCount/);
  assert.match(route, /legacyBookingCount/);
  assert.match(route, /requestedPhone && requestedPhone !== phone/);
  assert.match(route, /availableReplyChannels/);
  assert.match(route, /contact_center_thread_viewed/);
  assert.match(route, /contact_center_message_sent/);
  assert.match(route, /channel !== "whatsapp"/);
  assert.match(route, /\(organization_id, patient_id, phone_normalized, channel/);
});

test("contact-center UI exposes identity scopes, channels, delivery issues, and reply ambiguity", async () => {
  const [page, globals, styles] = await Promise.all([
    read("app/staff/chat/page.tsx"),
    read("app/globals.css"),
    read("app/styles/18-contact-center.css"),
  ]);
  assert.match(page, /title="Контакт-центр"/);
  for (const channel of ["whatsapp", "telegram", "sms", "email"]) assert.match(page, new RegExp(`"${channel}"`));
  assert.match(page, /Помилки доставки/);
  assert.match(page, /conversationKey/);
  assert.match(page, /identityKind/);
  assert.match(page, /sharedPhone/);
  assert.match(page, /Відповідь заблокована: потрібна ідентифікація/);
  assert.match(page, /replyChannels\.includes\("whatsapp"\)/);
  assert.match(page, /Legacy-історія не є карткою пацієнта/);
  assert.match(page, /спільний контакт/);
  assert.match(globals, /18-contact-center\.css/);
  assert.match(styles, /\.contactKpis/);
  assert.match(styles, /\.deliveryIssues/);
});