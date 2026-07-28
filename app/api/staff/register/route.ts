import { createSession } from "../../../../lib/staff-auth";
import { sessionCookie, SESSION_TTL_SECONDS } from "../../../../lib/auth";
import { isRateLimited } from "../../../../lib/rate-limit";
import {
  emailTaken,
  isValidEmail,
  normalizeEmail,
  passwordProblem,
  registerStaff,
  verifyAccessCode,
} from "../../../../lib/staff-accounts";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  if (await isRateLimited(db, request, "staff-register", 8, 30)) {
    return Response.json({ error: "Забагато спроб реєстрації. Спробуйте за 30 хвилин." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({})) as {
    email?: string; password?: string; displayName?: string; accessCode?: string;
  };
  const email = normalizeEmail(body.email);
  const displayName = String(body.displayName || "").trim().slice(0, 120);
  const password = String(body.password || "");
  const accessCode = String(body.accessCode || "");

  if (!displayName || displayName.length < 2) {
    return Response.json({ error: "Вкажіть ім’я та прізвище" }, { status: 400 });
  }
  if (!isValidEmail(email)) {
    return Response.json({ error: "Вкажіть коректний email" }, { status: 400 });
  }
  const pwProblem = passwordProblem(password);
  if (pwProblem) return Response.json({ error: pwProblem }, { status: 400 });
  if (!accessCode.trim()) {
    return Response.json({ error: "Вкажіть код доступу відділення" }, { status: 400 });
  }
  if (!(await verifyAccessCode(db, accessCode))) {
    return Response.json({ error: "Невірний код доступу відділення" }, { status: 403 });
  }
  if (await emailTaken(db, email)) {
    return Response.json({ error: "Акаунт із таким email уже існує" }, { status: 409 });
  }

  const member = await registerStaff(db, { email, displayName, password });
  const rawToken = await createSession(db, member.email);
  return Response.json(
    { ok: true, staff: member },
    {
      status: 201,
      headers: { "set-cookie": sessionCookie(rawToken, SESSION_TTL_SECONDS), "cache-control": "no-store" },
    },
  );
}
