import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("messaging-test endpoint is admin-only and sends via the saved gateway", async () => {
  const route = await read("app/api/staff/settings/messaging-test/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /ctx\.role !== "admin"/);
  assert.doesNotMatch(route, /requireStaff\(request, db\)/);
  assert.match(route, /createMessagingProvider\(/);
  assert.match(route, /messaging\.sendSms\(/);
  assert.match(route, /messaging\.sendEmail\(/);
  // Валідація каналу й отримувача до відправлення.
  assert.match(route, /body\.channel === "email"/);
  assert.match(route, /normalizeUkrainianPhone\(/);
  assert.match(route, /Спершу збережіть адресу SMS-шлюзу/);
  assert.match(route, /Спершу збережіть адресу e-mail-шлюзу/);
  // Причина помилки шлюзу повертається дослівно.
  assert.match(route, /error instanceof Error \? error\.message/);
});

test("settings page exposes SMS and e-mail test buttons", async () => {
  const page = await read("app/staff/settings/page.tsx");
  assert.match(page, /messaging-test/);
  assert.match(page, /sendMessagingTest\("sms"\)/);
  assert.match(page, /sendMessagingTest\("email"\)/);
  assert.match(page, /Тест SMS/);
  assert.match(page, /Тест e-mail/);
  // Кнопки заблоковані, доки шлюз не збережено.
  assert.match(page, /disabled=\{msgTesting === "sms" \|\| !settings\?\.smsGatewayUrl\}/);
  assert.match(page, /disabled=\{msgTesting === "email" \|\| !settings\?\.emailGatewayUrl\}/);
});
