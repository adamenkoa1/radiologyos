// Department settings managed by an administrator: Telegram notifications for
// new bookings and the PrivatBank payment link for civilian patients.

import { requireStaff } from "../../../../lib/staff-auth";
import { getSettings, setSetting } from "../../../../lib/settings";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const member = await requireStaff(request, db);
  if (!member) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (member.role !== "admin") return Response.json({ error: "Налаштування доступні лише адміністратору" }, { status: 403 });

  const values = await getSettings(db, ["telegram_bot_token", "telegram_chat_id", "pay_link"]);
  return Response.json({
    settings: {
      telegramConfigured: Boolean(values.telegram_bot_token && values.telegram_chat_id),
      telegramChatId: values.telegram_chat_id,
      payLink: values.pay_link,
    },
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
    telegramBotToken?: string; telegramChatId?: string; payLink?: string;
  };
  const chatId = clean(body.telegramChatId, 40);
  const payLink = clean(body.payLink, 500);
  // Empty token keeps the stored one (so the admin isn't forced to re-enter the
  // secret on every save); a value of "-" explicitly clears it.
  const token = clean(body.telegramBotToken, 120);

  if (payLink && !/^https:\/\//i.test(payLink)) {
    return Response.json({ error: "Посилання на оплату має починатися з https://" }, { status: 400 });
  }
  if (token && token !== "-" && !/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token)) {
    return Response.json({ error: "Некоректний токен бота Telegram" }, { status: 400 });
  }

  if (token === "-") await setSetting(db, "telegram_bot_token", "");
  else if (token) await setSetting(db, "telegram_bot_token", token);
  await setSetting(db, "telegram_chat_id", chatId);
  await setSetting(db, "pay_link", payLink);

  const values = await getSettings(db, ["telegram_bot_token", "telegram_chat_id", "pay_link"]);
  return Response.json({
    ok: true,
    settings: {
      telegramConfigured: Boolean(values.telegram_bot_token && values.telegram_chat_id),
      telegramChatId: values.telegram_chat_id,
      payLink: values.pay_link,
    },
  });
}
