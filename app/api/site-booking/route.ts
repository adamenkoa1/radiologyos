import { isBookableDate } from "../../../lib/booking-rules";
import { serviceByCode } from "../../../lib/catalog";
import { normalizeUkrainianPhone } from "../../../lib/phone";
import { normalizeDob } from "../../../lib/dob";
import { isRateLimited } from "../../../lib/rate-limit";
import { bookingMessage, sendTelegram } from "../../../lib/telegram";
import { effectivePrice } from "../../../lib/tariffs";
import { getSetting } from "../../../lib/settings";
import { parseSiteContent, SITE_CONTENT_KEY } from "../../../lib/site-content";
import { isDayOpen, parseSchedule, SCHEDULE_KEY } from "../../../lib/schedule";
import { dbBinding } from "../../../lib/db";

const CONSENT_VERSION = "2026-07-29";
const MAX_SERVICES_PER_REQUEST = 5;


function clean(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function idempotencyKey(request: Request): string {
  const value = (request.headers.get("idempotency-key") || "").trim();
  return /^[A-Za-z0-9_-]{16,80}$/.test(value) ? value : "";
}

const REFERRAL_TYPES = ["military_referral", "eh_referral", "paper_referral", "none", "other"];

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс запису тимчасово недоступний" }, { status: 503 });

  const requestKey = idempotencyKey(request);
  if (!requestKey) {
    return Response.json({ error: "Оновіть сторінку та повторіть надсилання заявки" }, { status: 400 });
  }
  const previous = await db.prepare(
    "SELECT response_json AS responseJson FROM booking_requests WHERE idempotency_key = ? LIMIT 1"
  ).bind(requestKey).first<{ responseJson: string }>();
  if (previous) {
    return Response.json(JSON.parse(previous.responseJson), { headers: { "cache-control": "no-store" } });
  }
  if (await isRateLimited(db, request, "site-booking", 8, 15)) {
    return Response.json({ error: "Забагато спроб. Спробуйте ще раз через 15 хвилин." }, { status: 429 });
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const name = clean(body.name, 120);
    const phone = clean(body.phone, 40);
    const phoneNormalized = normalizeUkrainianPhone(phone);
    const dob = normalizeDob(body.dob);
    const emailRaw = clean(body.email, 254).toLowerCase();
    const patientEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailRaw) ? emailRaw : "";
    const category = clean(body.category, 20) === "military" ? "military" : "civilian";
    // Режим вітрини «лише платні»: безкоштовні військові заявки не приймаються
    // на сервері (не лише ховаються в UI), інакше форму military.html можна
    // було б надіслати напряму.
    if (category === "military") {
      const storefront = parseSiteContent(await getSetting(db, SITE_CONTENT_KEY));
      if (storefront.storefrontType === "paid_only") {
        return Response.json(
          { error: "Безкоштовні дослідження для військовослужбовців зараз недоступні на цій вітрині" },
          { status: 403 },
        );
      }
    }
    let referralType = clean(body.referralType, 30);
    if (!REFERRAL_TYPES.includes(referralType)) referralType = "other";
    const comment = clean(body.comment, 700);
    const marketingSource = clean(body.source, 40);
    const desiredDate = clean(body.desiredDate, 10);
    const desiredTime = clean(body.desiredTime, 5);
    const consentVersion = clean(body.consentVersion, 20);

    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length < 1 || rawItems.length > MAX_SERVICES_PER_REQUEST) {
      return Response.json({ error: `Оберіть від 1 до ${MAX_SERVICES_PER_REQUEST} послуг` }, { status: 400 });
    }
    const serviceCodes = rawItems.map((item) => clean((item as { code?: unknown })?.code, 12));
    if (new Set(serviceCodes).size !== serviceCodes.length) {
      return Response.json({ error: "Одна й та сама послуга додана декілька разів" }, { status: 400 });
    }
    const services = serviceCodes.map((code) => serviceByCode(code));
    if (services.some((service) => !service)) {
      return Response.json({ error: "У заявці є невідома послуга" }, { status: 400 });
    }

    if (!name || !phoneNormalized) {
      return Response.json({ error: "Вкажіть ім’я та коректний телефон" }, { status: 400 });
    }
    if (!dob) {
      return Response.json({ error: "Вкажіть коректну дату народження" }, { status: 400 });
    }
    if (!isBookableDate(desiredDate)) {
      return Response.json({ error: "Оберіть доступну майбутню дату" }, { status: 400 });
    }
    // Публічний запис теж поважає графік клініки (робочі дні / вихідні), а не
    // лише staff-підтвердження — інакше у чергу потрапляли б заявки на закриті
    // дні. Час у межах годин звіряється при підтвердженні запису персоналом.
    const schedule = parseSchedule(await getSetting(db, SCHEDULE_KEY));
    if (!isDayOpen(desiredDate, schedule)) {
      return Response.json({ error: "У цей день клініка не працює — оберіть інший день" }, { status: 400 });
    }
    if (desiredTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(desiredTime)) {
      return Response.json({ error: "Вкажіть коректний бажаний час" }, { status: 400 });
    }
    if (body.consent !== true || consentVersion !== CONSENT_VERSION) {
      return Response.json({ error: "Потрібно підтвердити актуальну політику обробки даних" }, { status: 400 });
    }

    const codes = services.map(() => `RD-${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`);
    const prices = await Promise.all(services.map((service) => effectivePrice(db, service!.code)));
    const responseBody = { codes, code: codes[0] };
    const statements: D1PreparedStatement[] = [];

    services.forEach((service, index) => {
      const verifiedService = service!;
      const referral = referralType === "none" ? "Немає направлення" : referralType;
      const paymentStatus = category === "civilian" ? "pending" : "verification_required";
      const nszuStatus = referralType === "eh_referral" ? "pending" : "not_applicable";
      statements.push(
        db.prepare(
          `INSERT INTO bookings (
            code, name, phone, phone_normalized, patient_email, service, service_code, equipment_id,
            duration_minutes, desired_date, desired_time, referral, patient_category,
            referral_type, marketing_source, payment_status, payment_amount, nszu_status, comment,
            date_of_birth, consent_at, consent_version, consent_source
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?,?)`
        ).bind(
          codes[index], name, phone, phoneNormalized, patientEmail, verifiedService.title,
          verifiedService.code, verifiedService.equipmentId, verifiedService.durationMinutes,
          desiredDate, desiredTime, referral, category, referralType, marketingSource,
          paymentStatus, prices[index], nszuStatus, comment, dob, consentVersion, "public_site",
        ),
        db.prepare(
          `INSERT INTO booking_events (booking_id, action, details, actor)
           SELECT id, 'created', ?, 'patient' FROM bookings WHERE code = ?`
        ).bind(`${verifiedService.code} ${desiredDate} ${desiredTime || "час не обрано"}`, codes[index]),
      );
    });
    statements.push(
      db.prepare(
        "INSERT INTO booking_requests (idempotency_key, response_json) VALUES (?, ?)"
      ).bind(requestKey, JSON.stringify(responseBody)),
    );

    try {
      await db.batch(statements);
    } catch (error) {
      const raced = await db.prepare(
        "SELECT response_json AS responseJson FROM booking_requests WHERE idempotency_key = ? LIMIT 1"
      ).bind(requestKey).first<{ responseJson: string }>();
      if (raced) {
        return Response.json(JSON.parse(raced.responseJson), { headers: { "cache-control": "no-store" } });
      }
      throw error;
    }

    await sendTelegram(db, bookingMessage({
      codes,
      desiredDate,
      desiredTime,
    })).catch((error) => { console.error("telegram_notify_failed", codes[0], error); return false; });

    return Response.json(responseBody, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("site_booking_failed", error);
    return Response.json({ error: "Не вдалося зберегти заявку" }, { status: 500 });
  }
}
