// Публічний вебхук green-api для вхідних WhatsApp-повідомлень. Захищений
// секретним ?token=. Глобальна green-api конфігурація належить org 1, тому
// весь webhook data-path явно прив'язаний до основної організації: lookup
// записів, inbound/outbound communications і bot replies.

import { getSetting } from "../../../../lib/settings";
import { isRateLimited } from "../../../../lib/rate-limit";
import { parseSiteContent, SITE_CONTENT_KEY } from "../../../../lib/site-content";
import { interpretBotCommand, menuText, parseIncomingWebhook, sendWhatsApp } from "../../../../lib/whatsapp";
import { dbBinding } from "../../../../lib/db";

const PRIMARY_ORGANIZATION_ID = 1;

function todayKyiv(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// Порівняння токена за сталий час: хешуємо обидва значення й звіряємо дайджести
// (32 байти незалежно від довжини входу), тож ані значення, ані довжина секрета
// не витікають через тайминг.
async function tokenMatches(provided: string, expected: string): Promise<boolean> {
  if (!expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(provided)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
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
       WHERE organization_id = ? AND phone_normalized = ? AND desired_date >= ? AND status NOT IN ('cancelled','completed')
       ORDER BY desired_date, desired_time LIMIT 5`
    ).bind(PRIMARY_ORGANIZATION_ID, phone, todayKyiv()).all();
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
  // Токен приймаємо із заголовка (не тече в логи/Referer), із сумісним
  // фолбеком на ?token= для наявних налаштувань green-api.
  const token = request.headers.get("x-webhook-token") || url.searchParams.get("token") || "";
  const expected = await getSetting(db, "whatsapp_webhook_token");
  if (!(await tokenMatches(token, expected))) return Response.json({ ok: false }, { status: 401 });
  // Нижча стеля: обмежує спровокований зловмисником вихідний трафік (платні
  // green-api надсилання) навіть якщо токен витік.
  if (await isRateLimited(db, request, "whatsapp-webhook", 60, 15)) return Response.json({ ok: true });

  const body = await request.json().catch(() => null);
  const msg = parseIncomingWebhook(body);
  if (!msg) return Response.json({ ok: true }); // не текстове/не вхідне — ігноруємо

  // Дедуплікація повторних вебхуків за idMessage всередині org 1.
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO patient_communications
      (organization_id, phone_normalized, channel, direction, summary, actor, external_id)
     VALUES (?, ?, 'whatsapp', 'inbound', ?, 'patient', ?)`
  ).bind(
    PRIMARY_ORGANIZATION_ID,
    msg.phoneNormalized,
    msg.text || "(без тексту)",
    msg.idMessage || `${msg.phoneNormalized}-${msg.text.slice(0, 40)}`,
  ).run();
  if (!inserted.meta.changes) return Response.json({ ok: true }); // вже опрацьовано

  const reply = await botReply(db, msg.phoneNormalized, msg.text, url.origin);
  if (reply) {
    const sent = await sendWhatsApp(db, msg.phoneNormalized, reply);
    if (sent.ok) {
      await db.prepare(
        `INSERT INTO patient_communications
          (organization_id, phone_normalized, channel, direction, summary, actor, external_id)
         VALUES (?, ?, 'whatsapp', 'outbound', ?, 'bot', ?)`
      ).bind(PRIMARY_ORGANIZATION_ID, msg.phoneNormalized, reply, sent.idMessage || "").run();
    }
  }
  return Response.json({ ok: true });
}
