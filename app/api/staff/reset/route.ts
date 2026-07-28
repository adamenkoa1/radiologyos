import { isRateLimited } from "../../../../lib/rate-limit";
import {
  isValidEmail,
  normalizeEmail,
  passwordProblem,
  resetStaffPassword,
  verifyAccessCode,
} from "../../../../lib/staff-accounts";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "Сервіс тимчасово недоступний" }, { status: 503 });
  if (await isRateLimited(db, request, "staff-reset", 8, 30)) {
    return Response.json({ error: "Забагато спроб. Спробуйте за 30 хвилин." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({})) as {
    email?: string; password?: string; accessCode?: string;
  };
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const accessCode = String(body.accessCode || "");

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

  const changed = await resetStaffPassword(db, email, password);
  if (!changed) {
    return Response.json({ error: "Акаунт із таким email не знайдено" }, { status: 404 });
  }
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
