// Надсилає тестове SMS / e-mail через збережений шлюз, щоб адміністратор міг
// перевірити налаштування в один клік (аналог telegram-test). Помилку шлюзу
// повертає дослівно, щоб було видно причину (401, таймаут, заборонена адреса).
// Messaging gateway settings are legacy-global, so only org 1 may use them.

import { requireOrgContext } from "../../../../../lib/tenant";
import { getSettings } from "../../../../../lib/settings";
import { createMessagingProvider } from "../../../../../lib/providers/messaging";
import { normalizeUkrainianPhone } from "../../../../../lib/phone";
import { dbBinding } from "../../../../../lib/db";

const PRIMARY_ORGANIZATION_ID = 1;
const TEST_TEXT = "RadiologyOS: тестове повідомлення. Канал сповіщень налаштовано правильно.";

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (ctx.organizationId !== PRIMARY_ORGANIZATION_ID || ctx.role !== "admin") {
    return Response.json({ error: "Доступно лише адміністратору основної організації" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { channel?: string; to?: string };
  const channel = body.channel === "email" ? "email" : body.channel === "sms" ? "sms" : "";
  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (!channel) return Response.json({ error: "Невідомий канал" }, { status: 400 });
  if (!to) return Response.json({ error: "Вкажіть отримувача для тесту" }, { status: 400 });

  const cfg = await getSettings(db, [
    "sms_gateway_url", "sms_gateway_auth",
    "email_gateway_url", "email_gateway_auth", "email_gateway_from",
  ]);
  const messaging = createMessagingProvider({
    sms: { url: cfg.sms_gateway_url || "", auth: cfg.sms_gateway_auth || "" },
    email: { url: cfg.email_gateway_url || "", auth: cfg.email_gateway_auth || "", from: cfg.email_gateway_from || "" },
  });

  try {
    if (channel === "sms") {
      if (!cfg.sms_gateway_url) return Response.json({ error: "Спершу збережіть адресу SMS-шлюзу" }, { status: 400 });
      const phone = normalizeUkrainianPhone(to);
      if (!phone) return Response.json({ error: "Некоректний номер телефону" }, { status: 400 });
      await messaging.sendSms(phone, TEST_TEXT);
    } else {
      if (!cfg.email_gateway_url) return Response.json({ error: "Спершу збережіть адресу e-mail-шлюзу" }, { status: 400 });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return Response.json({ error: "Некоректна адреса e-mail" }, { status: 400 });
      await messaging.sendEmail(to, "RadiologyOS — тест", TEST_TEXT);
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Не вдалося надіслати" }, { status: 400 });
  }
  return Response.json({ ok: true });
}
