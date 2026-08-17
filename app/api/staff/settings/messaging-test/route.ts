// Надсилає тестове SMS / e-mail через шлюз поточної організації.
// Integration credentials are resolved only from the server-derived tenant
// context; secondary organizations never inherit org1 gateways.

import { canManageSystem } from "../../../../../lib/staff-auth";
import { requireSystemOrgContext } from "../../../../../lib/tenant";
import { getOrganizationIntegrationSettings } from "../../../../../lib/settings";
import { createMessagingProvider } from "../../../../../lib/providers/messaging";
import { normalizeUkrainianPhone } from "../../../../../lib/phone";
import { dbBinding } from "../../../../../lib/db";
import { audit } from "../../../../../lib/audit";

const TEST_TEXT = "RadiologyOS: тестове повідомлення. Канал сповіщень налаштовано правильно.";

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireSystemOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  if (!canManageSystem(ctx.role)) {
    return Response.json({ error: "Доступно лише системному адміністратору організації" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as { channel?: string; to?: string };
  const channel = body.channel === "email" ? "email" : body.channel === "sms" ? "sms" : "";
  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (!channel) return Response.json({ error: "Невідомий канал" }, { status: 400 });
  if (!to) return Response.json({ error: "Вкажіть отримувача для тесту" }, { status: 400 });

  const cfg = await getOrganizationIntegrationSettings(db, ctx.organizationId, [
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

  await audit(db, {
    organizationId: ctx.organizationId,
    actorEmail: ctx.member.email,
    action: "messaging_integration_test",
    resource: "settings",
    details: { scope: "organization_integrations", channel },
  });
  return Response.json({ ok: true });
}
