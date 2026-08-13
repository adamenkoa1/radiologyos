// Department settings managed by an administrator. Staff-facing configuration
// is tenant-scoped; organization 1 is mirrored to the legacy public store by
// setOrgSettingCompat during the incremental migration.

import { requireOrgContext } from "../../../../lib/tenant";
import { getOrgSettings, setOrgSettingCompat } from "../../../../lib/settings";
import { safeOutboundUrl } from "../../../../lib/outbound";
import { parseLeadHours, REMINDER_LEAD_KEY } from "../../../../lib/reminders";
import { dbBinding } from "../../../../lib/db";
import { audit } from "../../../../lib/audit";

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

const SETTING_KEYS = [
  "telegram_bot_token", "telegram_chat_id", "pay_link",
  "calendar_token_hash", "external_ics_url",
  "patient_reminders_enabled", "sms_gateway_url", "sms_gateway_auth",
  "email_gateway_url", "email_gateway_auth", "email_gateway_from",
  REMINDER_LEAD_KEY,
];

function settingsView(values: Record<string, string>) {
  return {
    telegramConfigured: Boolean(values.telegram_bot_token && values.telegram_chat_id),
    telegramChatId: values.telegram_chat_id,
    payLink: values.pay_link,
    calendarConfigured: Boolean(values.calendar_token_hash),
    externalIcsUrl: values.external_ics_url,
    remindersEnabled: Boolean(values.patient_reminders_enabled),
    reminderLeadHours: parseLeadHours(values[REMINDER_LEAD_KEY]).join(", "),
    smsGatewayUrl: values.sms_gateway_url,
    smsGatewayAuthSet: Boolean(values.sms_gateway_auth),
    emailGatewayUrl: values.email_gateway_url,
    emailGatewayAuthSet: Boolean(values.email_gateway_auth),
    emailGatewayFrom: values.email_gateway_from,
  };
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (ctx.role !== "admin") return Response.json({ error: "Налаштування доступні лише адміністратору" }, { status: 403 });

  const values = await getOrgSettings(db, ctx.organizationId, SETTING_KEYS);
  return Response.json({
    settings: settingsView(values),
    staff: { ...ctx.member, role: ctx.role },
  }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (ctx.role !== "admin") return Response.json({ error: "Змінювати налаштування може лише адміністратор" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as {
    telegramBotToken?: string; telegramChatId?: string; payLink?: string;
    externalIcsUrl?: string; remindersEnabled?: boolean; reminderLeadHours?: string;
    smsGatewayUrl?: string; smsGatewayAuth?: string;
    emailGatewayUrl?: string; emailGatewayAuth?: string; emailGatewayFrom?: string;
  };
  const chatId = clean(body.telegramChatId, 40);
  const payLink = clean(body.payLink, 500);
  const externalIcsUrl = clean(body.externalIcsUrl, 600);
  const smsGatewayUrl = clean(body.smsGatewayUrl, 600);
  const emailGatewayUrl = clean(body.emailGatewayUrl, 600);
  const emailGatewayFrom = clean(body.emailGatewayFrom, 254);
  const smsAuth = clean(body.smsGatewayAuth, 400);
  const emailAuth = clean(body.emailGatewayAuth, 400);
  const token = clean(body.telegramBotToken, 120);

  let paymentUrl: URL | null = null;
  try {
    paymentUrl = payLink ? new URL(payLink) : null;
  } catch {
    paymentUrl = null;
  }
  if (payLink && (!paymentUrl || paymentUrl.protocol !== "https:" || paymentUrl.username || paymentUrl.password)) {
    return Response.json({ error: "Посилання на оплату має починатися з https://" }, { status: 400 });
  }
  if (externalIcsUrl && !safeOutboundUrl(externalIcsUrl)) {
    return Response.json({ error: "Адреса календаря заборонена політикою зовнішніх підключень" }, { status: 400 });
  }
  if (smsGatewayUrl && !safeOutboundUrl(smsGatewayUrl)) {
    return Response.json({ error: "Адреса SMS-шлюзу заборонена політикою зовнішніх підключень" }, { status: 400 });
  }
  if (emailGatewayUrl && !safeOutboundUrl(emailGatewayUrl)) {
    return Response.json({ error: "Адреса e-mail-шлюзу заборонена політикою зовнішніх підключень" }, { status: 400 });
  }
  if (emailGatewayFrom && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailGatewayFrom)) {
    return Response.json({ error: "Адреса відправника e-mail некоректна" }, { status: 400 });
  }
  if (token && token !== "-" && !/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token)) {
    return Response.json({ error: "Некоректний токен бота Telegram" }, { status: 400 });
  }

  const set = (key: string, value: string) => setOrgSettingCompat(db, ctx.organizationId, key, value);
  if (token === "-") await set("telegram_bot_token", "");
  else if (token) await set("telegram_bot_token", token);
  await set("telegram_chat_id", chatId);
  await set("pay_link", payLink);
  await set("external_ics_url", externalIcsUrl);
  await set("patient_reminders_enabled", body.remindersEnabled ? "1" : "");
  await set(REMINDER_LEAD_KEY, parseLeadHours(clean(body.reminderLeadHours, 40)).join(", "));
  await set("sms_gateway_url", smsGatewayUrl);
  await set("email_gateway_url", emailGatewayUrl);
  await set("email_gateway_from", emailGatewayFrom);
  if (smsAuth === "-") await set("sms_gateway_auth", "");
  else if (smsAuth) await set("sms_gateway_auth", smsAuth);
  if (emailAuth === "-") await set("email_gateway_auth", "");
  else if (emailAuth) await set("email_gateway_auth", emailAuth);

  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "settings_update",
    resource: "settings",
  });
  const values = await getOrgSettings(db, ctx.organizationId, SETTING_KEYS);
  return Response.json({ ok: true, settings: settingsView(values) });
}
