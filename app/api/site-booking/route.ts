import { recordAnalyticsEvent } from "../../../lib/analytics";
import { todayInKyiv } from "../../../lib/booking-rules";
import { effectiveServices, serviceAvailableTo } from "../../../lib/effective-services";
import { normalizeUkrainianPhone } from "../../../lib/phone";
import { isAdultDob, normalizeDob } from "../../../lib/dob";
import { isRateLimited } from "../../../lib/rate-limit";
import { bookingMessage, sendTelegram } from "../../../lib/telegram";
import { getSetting } from "../../../lib/settings";
import { parseSiteContent, SITE_CONTENT_KEY } from "../../../lib/site-content";
import { parseSchedule, SCHEDULE_KEY } from "../../../lib/schedule";
import { assignEarliestAppointments, type BusyBooking, type EquipmentBlock } from "../../../lib/auto-booking";
import { nextBookingCode } from "../../../lib/booking-code";
import { isCapacityConflict, reserveCapacityStatements } from "../../../lib/booking-capacity";
import { dbBinding } from "../../../lib/db";

const CONSENT_VERSION = "2026-07-29";
const MAX_SERVICES_PER_REQUEST = 5;
const PUBLIC_ORGANIZATION_ID = 1;

function clean(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function idempotencyKey(request: Request): string {
  const value = (request.headers.get("idempotency-key") || "").trim();
  return /^[A-Za-z0-9_-]{16,80}$/.test(value) ? value : "";
}

function analyticsJourney(request: Request): string {
  const value = (request.headers.get("x-analytics-journey-id") || "").trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : "";
}

function currentTimeInKyiv(): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date()).replace(".", ":");
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
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
    const commentRaw = clean(body.comment, 520);
    const resultDelivery = clean(body.resultDelivery, 20) === "email" && patientEmail ? "email" : "department";
    const resultNote = resultDelivery === "email"
      ? `Спосіб отримання результату: на email ${patientEmail}`
      : "Спосіб отримання результату: у відділенні";
    const comment = [commentRaw, resultNote].filter(Boolean).join("\n").slice(0, 700);
    const marketingSource = clean(body.source, 40);
    const consentVersion = clean(body.consentVersion, 20);

    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length < 1 || rawItems.length > MAX_SERVICES_PER_REQUEST) {
      return Response.json({ error: `Оберіть від 1 до ${MAX_SERVICES_PER_REQUEST} послуг` }, { status: 400 });
    }
    const serviceCodes = rawItems.map((item) => clean((item as { code?: unknown })?.code, 12));
    if (new Set(serviceCodes).size !== serviceCodes.length) {
      return Response.json({ error: "Одна й та сама послуга додана декілька разів" }, { status: 400 });
    }

    const serviceMap = new Map(
      (await effectiveServices(db, PUBLIC_ORGANIZATION_ID)).map((service) => [service.code, service]),
    );
    const services = serviceCodes.map((code) => serviceMap.get(code));
    if (services.some((service) => !service)) {
      return Response.json({ error: "У заявці є невідома послуга" }, { status: 400 });
    }
    if (services.some((service) => !serviceAvailableTo(service!, category))) {
      return Response.json({ error: "Одна з обраних послуг зараз недоступна для цієї категорії пацієнтів" }, { status: 400 });
    }

    if (name.split(/\s+/).filter(Boolean).length < 3) {
      return Response.json({ error: "Вкажіть прізвище, ім’я та по батькові повністю" }, { status: 400 });
    }
    if (!phoneNormalized) {
      return Response.json({ error: "Вкажіть коректний номер телефону" }, { status: 400 });
    }
    if (!dob) {
      return Response.json({ error: "Вкажіть коректну дату народження" }, { status: 400 });
    }
    if (!isAdultDob(dob)) {
      return Response.json({ error: "Онлайн-запис доступний пацієнтам від 18 років" }, { status: 400 });
    }
    const schedule = parseSchedule(await getSetting(db, SCHEDULE_KEY));
    if (body.consent !== true || consentVersion !== CONSENT_VERSION) {
      return Response.json({ error: "Потрібно підтвердити актуальну політику обробки даних" }, { status: 400 });
    }

    const fromDate = todayInKyiv();
    const throughDate = addDays(fromDate, 180);
    const [busyResult, blocksResult] = await Promise.all([
      db.prepare(
        `SELECT equipment_id AS equipmentId, desired_date AS date,
                desired_time AS startTime, duration_minutes AS durationMinutes
         FROM bookings
         WHERE organization_id = ? AND desired_date BETWEEN ? AND ?
           AND status IN ('new','confirmed','rescheduled')`
      ).bind(PUBLIC_ORGANIZATION_ID, fromDate, throughDate).all<BusyBooking>(),
      db.prepare(
        `SELECT equipment_id AS equipmentId, blocked_date AS date,
                start_time AS startTime, end_time AS endTime
         FROM equipment_blocks WHERE organization_id = ? AND blocked_date BETWEEN ? AND ?`
      ).bind(PUBLIC_ORGANIZATION_ID, fromDate, throughDate).all<EquipmentBlock>(),
    ]);
    const appointments = assignEarliestAppointments({
      services: services as NonNullable<(typeof services)[number]>[],
      schedule,
      bookings: busyResult.results,
      blocks: blocksResult.results,
      fromDate,
      fromTime: currentTimeInKyiv(),
    });
    if (!appointments) {
      return Response.json(
        { error: "Наразі немає вільних слотів. Зателефонуйте в реєстратуру." },
        { status: 409 },
      );
    }

    const codes: string[] = [];
    for (let i = 0; i < services.length; i += 1) codes.push(await nextBookingCode(db));
    const responseBody = { codes, code: codes[0], appointments, status: "new", statusLabel: "Заявку отримано — очікує підтвердження" };
    const statements: D1PreparedStatement[] = [];

    services.forEach((service, index) => {
      const verifiedService = service!;
      const appointment = appointments[index];
      const referral = referralType === "none" ? "Немає направлення" : referralType;
      const paymentStatus = category === "civilian" ? "pending" : "verification_required";
      const nszuStatus = referralType === "eh_referral" ? "pending" : "not_applicable";
      statements.push(
        db.prepare(
          `INSERT INTO bookings (
            organization_id, code, name, phone, phone_normalized, patient_email, service, service_code, equipment_id,
            duration_minutes, desired_date, desired_time, status, referral, patient_category,
            referral_type, marketing_source, payment_status, payment_amount, nszu_status, comment,
            assigned_radiologist_email, assigned_radiographer_email,
            date_of_birth, consent_at, consent_version, consent_source
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'new',?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?,?)`
        ).bind(
          PUBLIC_ORGANIZATION_ID, codes[index], name, phone, phoneNormalized, patientEmail, verifiedService.title,
          verifiedService.code, verifiedService.equipmentId, verifiedService.durationMinutes,
          appointment.date, appointment.time, referral, category, referralType, marketingSource,
          paymentStatus, verifiedService.price, nszuStatus, comment,
          schedule.equipment[verifiedService.equipmentId]?.radiologistEmail || "",
          schedule.equipment[verifiedService.equipmentId]?.radiographerEmail || "",
          dob, consentVersion, "public_site",
        ),
        ...reserveCapacityStatements(db, {
          organizationId: PUBLIC_ORGANIZATION_ID,
          equipmentId: verifiedService.equipmentId,
          date: appointment.date,
          startTime: appointment.time,
          durationMinutes: verifiedService.durationMinutes,
          bookingCode: codes[index],
        }),
        db.prepare(
          `INSERT INTO booking_events (organization_id, booking_id, action, details, actor)
           SELECT ?, id, 'created', ?, 'patient' FROM bookings WHERE organization_id = ? AND code = ?`
        ).bind(
          PUBLIC_ORGANIZATION_ID,
          `${verifiedService.code} ${appointment.date} ${appointment.time} · слот попередньо зарезервовано`,
          PUBLIC_ORGANIZATION_ID,
          codes[index],
        ),
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
      if (isCapacityConflict(error)) {
        return Response.json(
          { error: "Обраний час щойно зайняли. Оновіть доступні слоти та повторіть запис." },
          { status: 409, headers: { "cache-control": "no-store" } },
        );
      }
      throw error;
    }

    const journeyId = analyticsJourney(request);
    await Promise.all(services.map((service) => recordAnalyticsEvent(db, {
      eventName: "booking_created",
      organizationId: PUBLIC_ORGANIZATION_ID,
      journeyId,
      serviceCode: service!.code,
      patientCategory: category,
      source: "server",
    })));

    await sendTelegram(db, bookingMessage({
      codes,
      desiredDate: appointments[0].date,
      desiredTime: appointments[0].time,
    })).catch((error) => { console.error("telegram_notify_failed", codes[0], error); return false; });

    return Response.json(responseBody, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("site_booking_failed", error);
    return Response.json({ error: "Не вдалося зберегти заявку" }, { status: 500 });
  }
}