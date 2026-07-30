import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// Контракти провайдерів визначені як єдині інтерфейси інтеграцій.
test("provider contracts define the four integration interfaces", async () => {
  const types = await read("lib/providers/types.ts");
  for (const iface of ["MessagingProvider", "PaymentProvider", "PacsProvider", "CalendarProvider"]) {
    assert.match(types, new RegExp(`interface ${iface}`), `${iface} defined`);
  }
  assert.match(types, /class ProviderNotConfiguredError/);
});

// Месенджинг-адаптер шле через політику зовнішніх підключень; ненастроєний
// канал кидає типізовану помилку «не налаштовано».
test("messaging provider goes through outbound policy and flags unconfigured channels", async () => {
  const msg = await read("lib/providers/messaging.ts");
  assert.match(msg, /export function createMessagingProvider/);
  assert.match(msg, /safeOutboundUrl/);
  assert.match(msg, /fetchLimited/);
  assert.match(msg, /capabilities: \{ sms: !!smsUrl, email: !!emailUrl \}/);
  assert.match(msg, /ProviderNotConfiguredError\("SMS"\)/);
  assert.match(msg, /ProviderNotConfiguredError\("email"\)/);
});

// Резолвер — tenant-контекст; PACS під контролем feature flag профілю.
test("resolver is tenant-aware and PACS honors the dicom_pacs flag", async () => {
  const idx = await read("lib/providers/index.ts");
  assert.match(idx, /export async function resolveProviders\(db: D1Database, ctx: OrgContext\)/);
  assert.match(idx, /getOrgProfile\(db, ctx\)/);
  assert.match(idx, /profile\.flags\.dicom_pacs.*pacsRow\?\.enabled|Boolean\(profile\.flags\.dicom_pacs\)/);
  assert.match(idx, /createMessagingProvider/);
});

// Рушій нагадувань тепер доставляє через месенджинг-провайдер (адаптовано).
test("reminder engine delegates delivery to the messaging provider", async () => {
  const notify = await read("lib/notify.ts");
  assert.match(notify, /createMessagingProvider/);
  assert.match(notify, /messaging\.sendSms\(/);
  assert.match(notify, /messaging\.sendEmail\(/);
  // Інлайновий postJson прибрано — доставлення живе у провайдері.
  assert.doesNotMatch(notify, /async function postJson/);
  // Незламна семантика збережена: канали, «не турбувати», best-effort.
  assert.match(notify, /do_not_contact/);
  assert.match(notify, /catch/);
});

// Діагностичний ендпойнт стану інтеграцій — tenant-scoped, лише адмін.
test("providers status endpoint is tenant-scoped and admin-only", async () => {
  const route = await read("app/api/staff/providers/route.ts");
  assert.match(route, /requireOrgContext\(request, db\)/);
  assert.match(route, /ctx\.role !== "admin"/);
  assert.match(route, /resolveProviders\(db, ctx\)/);
});
