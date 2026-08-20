import { createSession } from "../../../../lib/staff-auth";
import {
  hashPassword,
  isCompromisedPasswordHash,
  passwordHashNeedsUpgrade,
  sessionCookie,
  SESSION_TTL_SECONDS,
  verifyPassword,
} from "../../../../lib/auth";
import {
  clearIdentifierRateLimit,
  isIdentifierRateLimited,
  isRateLimited,
  recordIdentifierRateLimitFailure,
} from "../../../../lib/rate-limit";
import { normalizeUkrainianPhone } from "../../../../lib/phone";
import { dbBinding } from "../../../../lib/db";
import { audit } from "../../../../lib/audit";

const STAFF_LOGIN_LIMIT = 10;
const STAFF_LOGIN_WINDOW_MINUTES = 15;

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  if (await isRateLimited(db, request, "staff-login", STAFF_LOGIN_LIMIT, STAFF_LOGIN_WINDOW_MINUTES)) {
    return Response.json({ error: "Забагато спроб входу. Спробуйте за 15 хвилин." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({})) as { phone?: string; email?: string; password?: string };
  const phone = normalizeUkrainianPhone(String(body.phone || ""));
  const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
  const password = String(body.password || "");
  if ((!phone && !email) || !password) {
    return Response.json({ error: "Вкажіть номер телефону і PIN-код" }, { status: 400 });
  }

  // Вхід за номером телефону (основний) або email (сумісність).
  const member = phone
    ? await db.prepare(
        "SELECT email, display_name AS displayName, role, password_hash AS passwordHash FROM staff_members WHERE phone = ? AND active = 1 LIMIT 1"
      ).bind(phone).first<{ email: string; displayName: string; role: string; passwordHash: string }>()
    : await db.prepare(
        "SELECT email, display_name AS displayName, role, password_hash AS passwordHash FROM staff_members WHERE email = ? AND active = 1 LIMIT 1"
      ).bind(email).first<{ email: string; displayName: string; role: string; passwordHash: string }>();

  // Known accounts are always throttled by one canonical account key, regardless
  // of whether the caller supplied phone or email. Unknown identifiers still get
  // their own hashed failure bucket, so raw phone/email values never reach
  // request_limits and repeated guesses for a nonexistent identifier are bounded.
  const submittedIdentifier = phone ? `phone:${phone}` : `email:${email}`;
  const accountIdentifier = member ? `account:${member.email.toLowerCase()}` : submittedIdentifier;
  if (await isIdentifierRateLimited(
    db,
    "staff-login-account",
    accountIdentifier,
    STAFF_LOGIN_LIMIT,
    STAFF_LOGIN_WINDOW_MINUTES,
  )) {
    return Response.json({ error: "Забагато спроб входу. Спробуйте за 15 хвилин." }, { status: 429 });
  }

  const compromised = member ? isCompromisedPasswordHash(member.passwordHash) : false;
  const ok = member && !compromised ? await verifyPassword(password, member.passwordHash) : false;
  if (!member || !ok) {
    await recordIdentifierRateLimitFailure(
      db,
      "staff-login-account",
      accountIdentifier,
      STAFF_LOGIN_LIMIT,
      STAFF_LOGIN_WINDOW_MINUTES,
    );
    await audit(db, {
      organizationId: 1,
      actorEmail: member?.email || phone || email || "невідомо",
      action: "login_failed", resource: "auth",
      details: { reason: compromised ? "compromised" : member ? "wrong_password" : "unknown_account" },
    });
    return Response.json({
      error: compromised
        ? "Початковий PIN заблоковано. Зверніться до адміністратора для безпечної заміни."
        : "Невірний номер телефону або PIN-код",
    }, { status: 401 });
  }

  await clearIdentifierRateLimit(db, "staff-login-account", accountIdentifier);

  if (passwordHashNeedsUpgrade(member.passwordHash)) {
    await db.prepare("UPDATE staff_members SET password_hash = ? WHERE email = ?")
      .bind(await hashPassword(password), member.email).run();
  }

  await audit(db, {
    organizationId: 1, actorEmail: member.email,
    action: "login", resource: "auth", details: { via: phone ? "phone" : "email" },
  });
  const rawToken = await createSession(db, member.email);
  return Response.json(
    { ok: true, staff: { email: member.email, displayName: member.displayName, role: member.role } },
    { headers: { "set-cookie": sessionCookie(rawToken, SESSION_TTL_SECONDS), "cache-control": "no-store" } },
  );
}
