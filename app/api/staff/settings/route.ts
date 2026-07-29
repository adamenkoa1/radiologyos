// Department settings managed by an administrator: Telegram notifications for
// new bookings and the PrivatBank payment link for civilian patients.

import { requireStaff } from "../../../../lib/staff-auth";
import { getSettings, setSetting } from "../../../../lib/settings";
import { hashPassword } from "../../../../lib/auth";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

const SETTING_KEYS = [
  "telegram_bot_token", "telegram_chat_id", "pay_link", "registration_code_hash",
  "calendar_token", "external_ics_url",
  "patient_reminders_enabled", "sms_gateway_url", "sms_gateway_auth",
  "email_gateway_url", "email_gateway_auth", "email_gateway_from",
];

function settingsView(values: Record<string, string>) {
  return {
    telegramConfigured: Boolean(values.telegram_bot_token && values.telegram_chat_id),
    telegramChatId: values.telegram_chat_id,
    payLink: values.pay_link,
    registrationCodeSet: Boolean(values.registration_code_hash),
    calendarToken: values.calendar_token,
    externalIcsUrl: values.external_ics_url,
    remindersEnabled: Boolean(values.patient_reminders_enabled),
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
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (member.role !== "admin") return Response.json({ error: "Налаштування доступні лише адміністратору" }, { status: 403 });

  const values = await getSettings(db, SETTING_KEYS);
  return Response.json({
    settings: settingsView(values),
    staff: member,
  }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (member.role !== "admin") return Response.json({ error: "Змінювати налаштування може лише адміністратор" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as {
    telegramBotToken?: string; telegramChatId?: string; payLink?: string; accessCode?: string;
    externalIcsUrl?: string; remindersEnabled?: boolean;
    smsGatewayUrl?: string; smsGatewayAuth?: string;
    emailGatewayUrl?: string; emailGatewayAuth?: string; emailGatewayFrom?: string;
  };
  const chatId = clean(body.telegramChatId, 40);
  const payLink = clean(body.payLink, 500);
  const externalIcsUrl = clean(body.externalIcsUrl, 600);
  const smsGatewayUrl = clean(body.smsGatewayUrl, 600);
  const emailGatewayUrl = clean(body.emailGatewayUrl, 600);
  const emailGatewayFrom = clean(body.emailGatewayFrom, 254);
  // Секрети шлюзів: порожнє зберігає поточне, "-" очищує (як токен Telegram).
  const smsAuth = clean(body.smsGatewayAuth, 400);
  const emailAuth = clean(body.emailGatewayAuth, 400);
  // Empty token keeps the stored one (so the admin isn't forced to re-enter the
  // secret on every save); a value of "-" explicitly clears it.
  const token = clean(body.telegramBotToken, 120);
  // Empty access code keeps the current one; a value sets a new registration code.
  const accessCode = clean(body.accessCode, 64);

  if (payLink && !/^https:\/\//i.test(payLink)) {
    return Response.json({ error: "Посилання на оплату має починатися з https://" }, { status: 400 });
  }
  if (externalIcsUrl && !/^https?:\/\//i.test(externalIcsUrl)) {
    return Response.json({ error: "Посилання на календар має починатися з http(s)://" }, { status: 400 });
  }
  if (smsGatewayUrl && !/^https:\/\//i.test(smsGatewayUrl)) {
    return Response.json({ error: "Адреса SMS-шлюзу має починатися з https://" }, { status: 400 });
  }
  if (emailGatewayUrl && !/^https:\/\//i.test(emailGatewayUrl)) {
    return Response.json({ error: "Адреса e-mail-шлюзу має починатися з https://" }, { status: 400 });
  }
  if (emailGatewayFrom && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailGatewayFrom)) {
    return Response.json({ error: "Адреса відправника e-mail некоректна" }, { status: 400 });
  }
  if (token && token !== "-" && !/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token)) {
    return Response.json({ error: "Некоректний токен бота Telegram" }, { status: 400 });
  }
  if (accessCode && accessCode.length < 6) {
    return Response.json({ error: "Код доступу має містити щонайменше 6 символів" }, { status: 400 });
  }

  if (token === "-") await setSetting(db, "telegram_bot_token", "");
  else if (token) await setSetting(db, "telegram_bot_token", token);
  await setSetting(db, "telegram_chat_id", chatId);
  await setSetting(db, "pay_link", payLink);
  await setSetting(db, "external_ics_url", externalIcsUrl);
  if (accessCode) await setSetting(db, "registration_code_hash", await hashPassword(accessCode));

  await setSetting(db, "patient_reminders_enabled", body.remindersEnabled ? "1" : "");
  await setSetting(db, "sms_gateway_url", smsGatewayUrl);
  await setSetting(db, "email_gateway_url", emailGatewayUrl);
  await setSetting(db, "email_gateway_from", emailGatewayFrom);
  if (smsAuth === "-") await setSetting(db, "sms_gateway_auth", "");
  else if (smsAuth) await setSetting(db, "sms_gateway_auth", smsAuth);
  if (emailAuth === "-") await setSetting(db, "email_gateway_auth", "");
  else if (emailAuth) await setSetting(db, "email_gateway_auth", emailAuth);

  const values = await getSettings(db, SETTING_KEYS);
  return Response.json({ ok: true, settings: settingsView(values) });
}
