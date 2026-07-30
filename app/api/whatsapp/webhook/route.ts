// Публічний вебхук green-api для вхідних WhatsApp-повідомлень. Захищений
// секретним ?token=. Зберігає повідомлення в patient_communications, дедуплікує
// за idMessage і за потреби відповідає бот-меню.

import { getSetting } from "../../../../lib/settings";
import { isRateLimited } from "../../../../lib/rate-limit";
import { parseSiteContent, SITE_CONTENT_KEY } from "../../../../lib/site-content";
import { interpretBotCommand, menuText, parseIncomingWebhook, sendWhatsApp } from "../../../../lib/whatsapp";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

function todayKyiv(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function botReply(db: D1Database, phone: string, text: string, origin: string): Promise<string | null> {
  const action = interpretBotCommand(text);
  if (action === "menu") return menuText();
  if (action === "human") return "Передав ваше звернення адміністратору — незабаром звʼяжемося.";
  if (action === "booking") return `Записатися можна тут: ${origin}\nОберіть послугу й натисніть «Записатися».`;
  if (action === "info") {
    const content = parseSiteContent(await getSetting(db, SITE_CONTENT_KEY));
    return [content.brandTitle, `📍 ${content.address}`, `🕒 ${content.workHours}`, `📞 ${content.phone}`, `Ціни: ${origin}`].filter(Boolean).join("\n");
  }
  if (action === "appointments") {
    const rows = await db.prepare(
      `SELECT service, desired_date AS d, desired_time AS t, status FROM bookings
       WHERE phone_normalized = ? AND desired_date >= ? AND status NOT IN ('cancelled','completed')
       ORDER BY desired_date, desired_time LIMIT 5`
    ).bind(phone, todayKyiv()).all();
    const list = (rows.results || []) as Array<{ service: string; d: string; t: string }>;
    if (!list.length) return "У вас немає найближчих записів. Надішліть 2, щоб записатися.";
    return ["Ваші найближчі записи:", ...list.map((r) => `• ${r.d}${r.t ? ` ${r.t}` : ""} — ${r.service}`)].join("\n");
  }
  return null; // не з меню — лишаємо персоналу, без автовідповіді
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ ok: false }, { status: 503 });

  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const expected = await getSetting(db, "whatsapp_webhook_token");
  if (!expected || token !== expected) return Response.json({ ok: false }, { status: 401 });
  if (await isRateLimited(db, request, "whatsapp-webhook", 120, 15)) return Response.json({ ok: true });

  const body = await request.json().catch(() => null);
  const msg = parseIncomingWebhook(body);
  if (!msg) return Response.json({ ok: true }); // не текстове/не вхідне — ігноруємо

  // Дедуплікація повторних вебхуків за idMessage.
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO patient_communications (phone_normalized, channel, direction, summary, actor, external_id)
     VALUES (?, 'whatsapp', 'inbound', ?, 'patient', ?)`
  ).bind(msg.phoneNormalized, msg.text || "(без тексту)", msg.idMessage || `${msg.phoneNormalized}-${msg.text.slice(0, 40)}`).run();
  if (!inserted.meta.changes) return Response.json({ ok: true }); // вже опрацьовано

  const reply = await botReply(db, msg.phoneNormalized, msg.text, url.origin);
  if (reply) {
    const sent = await sendWhatsApp(db, msg.phoneNormalized, reply);
    if (sent.ok) {
      await db.prepare(
        `INSERT INTO patient_communications (phone_normalized, channel, direction, summary, actor, external_id)
         VALUES (?, 'whatsapp', 'outbound', ?, 'bot', ?)`
      ).bind(msg.phoneNormalized, reply, sent.idMessage || "").run();
    }
  }
  return Response.json({ ok: true });
}
