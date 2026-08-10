import { audit } from "../../../lib/audit";
import { hashPassword, newSessionToken } from "../../../lib/auth";
import { normalizeDob } from "../../../lib/dob";
import {
  createPatientOtpChallenge,
  createPatientSession,
  normalizeBookingCode,
  normalizeOtp,
  patientSessionCookie,
  verifyPatientOtpChallenge,
} from "../../../lib/patient-auth";
import { normalizeUkrainianPhone } from "../../../lib/phone";
import { createMessagingProvider } from "../../../lib/providers/messaging";
import { isRateLimited } from "../../../lib/rate-limit";
import { getSettings } from "../../../lib/settings";
import { dbBinding } from "../../../lib/db";

const PURPOSE = "cabinet_login";
const PHONE_REQUEST_LIMIT = 5;

function maskedPhone(phoneNormalized: string): string {
  return phoneNormalized ? `***${phoneNormalized.slice(-4)}` : "";
}

async function proofOrganization(
  db: D1Database,
  phoneNormalized: string,
  body: { dob?: unknown; bookingCode?: unknown },
): Promise<number | null> {
  const dob = normalizeDob(body.dob);
  if (dob) {
    const row = await db.prepare(
      `SELECT organization_id AS organizationId
       FROM bookings
       WHERE phone_normalized = ? AND date_of_birth = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    ).bind(phoneNormalized, dob).first<{ organizationId: number }>();
    return row?.organizationId || null;
  }

  const bookingCode = normalizeBookingCode(body.bookingCode);
  if (bookingCode) {
    const row = await db.prepare(
      `SELECT organization_id AS organizationId
       FROM bookings WHERE phone_normalized = ? AND code = ? LIMIT 1`,
    ).bind(phoneNormalized, bookingCode).first<{ organizationId: number }>();
    return row?.organizationId || null;
  }
  return null;
}

// Step 1: prove a known booking identity (phone+DOB or phone+booking code), then
// deliver a possession challenge. Unknown identities receive the same neutral
// response shape and never get a session/challenge row.
export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });

  const body = await request.json().catch(() => ({})) as {
    phone?: unknown;
    dob?: unknown;
    bookingCode?: unknown;
  };
  const phoneNormalized = normalizeUkrainianPhone(String(body.phone || ""));
  if (!phoneNormalized || (!normalizeDob(body.dob) && !normalizeBookingCode(body.bookingCode))) {
    return Response.json({ error: "Введіть номер телефону та дані запису" }, { status: 400 });
  }

  if (await isRateLimited(db, request, `patient-otp-request:${phoneNormalized}`, 5, 15)) {
    return Response.json({ error: "Забагато запитів коду. Спробуйте пізніше." }, { status: 429 });
  }

  const cfg = await getSettings(db, ["sms_gateway_url", "sms_gateway_auth"]);
  const messaging = createMessagingProvider({
    sms: { url: cfg.sms_gateway_url || "", auth: cfg.sms_gateway_auth || "" },
    email: { url: "", auth: "", from: "" },
  });
  // Do not fall back to knowledge-only login if possession verification is
  // unavailable. The check happens before identity lookup to avoid enumeration.
  if (!messaging.capabilities.sms) {
    return Response.json(
      { error: "Підтвердження номера телефону тимчасово недоступне" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  const organizationId = await proofOrganization(db, phoneNormalized, body);
  if (!organizationId) {
    // Burn similar local crypto work and return an opaque fake challenge id.
    // No database row exists, so verification can never succeed.
    await hashPassword("000000");
    return Response.json(
      {
        ok: true,
        challengeId: newSessionToken(),
        expiresIn: 300,
        message: "Якщо дані збігаються із записом, код підтвердження надіслано.",
      },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  }

  const recent = await db.prepare(
    `SELECT COUNT(*) AS n FROM patient_otp_challenges
     WHERE organization_id = ? AND phone_normalized = ? AND purpose = ?
       AND created_at > datetime('now', '-15 minutes')`,
  ).bind(organizationId, phoneNormalized, PURPOSE).first<{ n: number }>();
  if ((recent?.n || 0) >= PHONE_REQUEST_LIMIT) {
    return Response.json({ error: "Забагато запитів коду. Спробуйте пізніше." }, { status: 429 });
  }

  const challenge = await createPatientOtpChallenge(db, phoneNormalized, organizationId, PURPOSE);
  const text = `RadiologyOS: код підтвердження ${challenge.code}. Код діє 5 хвилин. Нікому його не повідомляйте.`;
  try {
    await messaging.sendSms(`+${phoneNormalized}`, text);
  } catch (error) {
    // A code that was never delivered must not remain usable.
    await db.prepare(
      "UPDATE patient_otp_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(challenge.challengeId).run().catch(() => undefined);
    await audit(db, {
      organizationId,
      actorEmail: "patient",
      action: "patient_otp_delivery_failed",
      resource: "patient_auth",
      targetId: challenge.challengeId.slice(0, 12),
      details: { phone: maskedPhone(phoneNormalized) },
    });
    console.error("patient_otp_delivery_failed", error instanceof Error ? error.message : "unknown");
    return Response.json(
      { error: "Не вдалося надіслати код підтвердження. Спробуйте пізніше." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  await audit(db, {
    organizationId,
    actorEmail: "patient",
    action: "patient_otp_requested",
    resource: "patient_auth",
    targetId: challenge.challengeId.slice(0, 12),
    details: { phone: maskedPhone(phoneNormalized), channel: "sms" },
  });
  return Response.json(
    {
      ok: true,
      challengeId: challenge.challengeId,
      expiresIn: challenge.expiresIn,
      message: "Код підтвердження надіслано на ваш номер телефону.",
    },
    { status: 202, headers: { "cache-control": "no-store" } },
  );
}

// Step 2: consume the one-time possession challenge and only then create the
// tenant-scoped patient session used by cabinet/result endpoints.
export async function PATCH(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });

  const body = await request.json().catch(() => ({})) as {
    phone?: unknown;
    challengeId?: unknown;
    code?: unknown;
  };
  const phoneNormalized = normalizeUkrainianPhone(String(body.phone || ""));
  const challengeId = String(body.challengeId || "").trim();
  const code = normalizeOtp(body.code);
  if (!phoneNormalized || !/^[a-f0-9]{64}$/i.test(challengeId) || !code) {
    return Response.json({ error: "Перевірте код підтвердження" }, { status: 400 });
  }
  if (await isRateLimited(db, request, `patient-otp-verify:${phoneNormalized}`, 8, 15)) {
    return Response.json({ error: "Забагато спроб. Спробуйте пізніше." }, { status: 429 });
  }

  const challengeScope = await db.prepare(
    `SELECT organization_id AS organizationId FROM patient_otp_challenges
     WHERE id = ? AND phone_normalized = ? LIMIT 1`,
  ).bind(challengeId, phoneNormalized).first<{ organizationId: number }>();

  const verified = await verifyPatientOtpChallenge(db, {
    challengeId,
    phoneNormalized,
    code,
    purpose: PURPOSE,
  });
  if (!verified) {
    await audit(db, {
      organizationId: challengeScope?.organizationId || 1,
      actorEmail: "patient",
      action: "patient_otp_failed",
      resource: "patient_auth",
      targetId: challengeId.slice(0, 12),
      details: { phone: maskedPhone(phoneNormalized) },
    });
    return Response.json({ error: "Невірний або прострочений код підтвердження" }, { status: 401 });
  }

  const rawToken = await createPatientSession(db, phoneNormalized, verified.organizationId);
  await audit(db, {
    organizationId: verified.organizationId,
    actorEmail: "patient",
    action: "patient_otp_verified",
    resource: "patient_auth",
    targetId: challengeId.slice(0, 12),
    details: { phone: maskedPhone(phoneNormalized) },
  });
  return Response.json(
    { ok: true },
    {
      headers: {
        "set-cookie": patientSessionCookie(rawToken),
        "cache-control": "no-store",
      },
    },
  );
}
