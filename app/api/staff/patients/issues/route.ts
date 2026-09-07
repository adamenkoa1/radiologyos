// Read-only аудит суперечностей між джерелами даних пацієнта в межах
// організації. Тільки реєстратор/адміністратор; нічого не змінює.

import { canViewPatientRegistry, canMergePatients } from "../../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../../lib/tenant";
import { logSecurityEvent } from "../../../../../lib/audit";
import { dbBinding } from "../../../../../lib/db";
import {
  countFindings, sortFindings, mergeSafetyFields,
  staleContactFindings, duplicatePhoneFindings, linkableBookingFindings, nameDivergenceFindings,
  type StaleContactRow, type DuplicatePhoneMember, type LinkableBookingRow, type NameDivergenceRow,
  type MergeProfile,
} from "../../../../../lib/patient-consistency";

const LIMIT = 500;

export async function GET(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  const orgId = ctx.organizationId;
  if (!canViewPatientRegistry(member.role)) {
    return Response.json({ error: "Аудит карток доступний лише реєстратору або адміністратору" }, { status: 403 });
  }

  // Контакт exact-пацієнта в заявці розійшовся з карткою.
  const staleP = db.prepare(
    `SELECT b.id AS bookingId, b.code, b.name AS bookingName, b.phone_normalized AS bookingPhone,
       p.patient_id AS patientId, p.display_name AS displayName, p.phone_normalized AS profilePhone
     FROM bookings b
     JOIN patient_profiles p ON p.organization_id = b.organization_id AND p.patient_id = b.patient_id
     WHERE b.organization_id = ? AND b.patient_id != '' AND b.phone_normalized != ''
       AND b.phone_normalized != p.phone_normalized
     ORDER BY b.desired_date DESC LIMIT ?`
  ).bind(orgId, LIMIT).all();

  // Один номер у кількох картках — картки-члени для можливого злиття.
  const dupP = db.prepare(
    `SELECT phone_normalized AS phoneNormalized, patient_id AS patientId,
       display_name AS displayName, birth_date AS birthDate
     FROM patient_profiles
     WHERE organization_id = ? AND phone_normalized != ''
       AND phone_normalized IN (
         SELECT phone_normalized FROM patient_profiles
         WHERE organization_id = ? AND phone_normalized != ''
         GROUP BY phone_normalized HAVING COUNT(*) > 1
       )
     ORDER BY phone_normalized, updated_at DESC LIMIT ?`
  ).bind(orgId, orgId, LIMIT).all();

  // Неприв'язана заявка, чий номер збігається РІВНО з однією карткою.
  const linkP = db.prepare(
    `SELECT b.id AS bookingId, b.code, b.name AS bookingName, b.phone_normalized AS phoneNormalized,
       p.patient_id AS patientId, p.display_name AS displayName
     FROM bookings b
     JOIN patient_profiles p ON p.organization_id = b.organization_id AND p.phone_normalized = b.phone_normalized
     WHERE b.organization_id = ? AND b.patient_id = '' AND b.phone_normalized != ''
       AND (SELECT COUNT(*) FROM patient_profiles p2
            WHERE p2.organization_id = b.organization_id AND p2.phone_normalized = b.phone_normalized) = 1
     ORDER BY b.desired_date DESC LIMIT ?`
  ).bind(orgId, LIMIT).all();

  // Кандидати для звірки ПІБ (розбіжність рахуємо в чистій логіці).
  const nameP = db.prepare(
    `SELECT b.id AS bookingId, b.code, b.name AS bookingName,
       p.patient_id AS patientId, p.display_name AS displayName, p.phone_normalized AS phoneNormalized
     FROM bookings b
     JOIN patient_profiles p ON p.organization_id = b.organization_id AND p.patient_id = b.patient_id
     WHERE b.organization_id = ? AND b.name != '' AND p.display_name != ''
     ORDER BY b.desired_date DESC LIMIT ?`
  ).bind(orgId, LIMIT * 2).all();

  const [stale, dup, link, names] = await Promise.all([staleP, dupP, linkP, nameP]);

  const findings = sortFindings([
    ...staleContactFindings(stale.results as unknown as StaleContactRow[]),
    ...duplicatePhoneFindings(dup.results as unknown as DuplicatePhoneMember[]),
    ...linkableBookingFindings(link.results as unknown as LinkableBookingRow[]),
    ...nameDivergenceFindings(names.results as unknown as NameDivergenceRow[]),
  ]);
  const counts = countFindings(findings);

  await logSecurityEvent(db, {
    organizationId: orgId,
    actorEmail: member.email,
    action: "patient_consistency_viewed",
    resource: "patient_registry",
    details: { total: counts.total },
  });

  return Response.json({ findings, counts, staff: member }, { headers: { "cache-control": "no-store" } });
}

const PATIENT_ID_RE = /^[0-9a-f]{32}$/;

// Схема свідомо тримає patient_id незмінним у більшості таблиць, а фінансові/
// клінічні regистри — append-only. Тому злиття:
//  • ПЕРЕПРИЗНАЧАЄ patient_id лише там, де лінк дозволено переписати на картку
//    того ж тенанта (тригери *_patient_link_update пропускають, бо головна
//    картка існує) — це заявки й комунікації;
//  • незмінні регістри (revenue/settlement/service/result/order/appointment…)
//    НЕ чіпає: у них є booking_id, тож звʼязок із пацієнтом іде через заявку,
//    яку вже перепризначено, а власний patient_id лишається як історичний зліпок;
//  • ВИДАЛЯЄ ефемерні/переустановлювані рядки поглинутих карток, де patient_id
//    незмінний (сесії, OTP, токени й ідентичності Telegram, MWL-мапінг).
const REPOINT_TABLES = ["bookings", "patient_communications"];
const PURGE_TABLES = [
  "patient_sessions", "patient_otp_challenges", "telegram_link_tokens",
  "patient_telegram_identities", "mwl_patient_ids",
];

// Необоротне злиття карток пацієнта: уся історія поглинутих карток
// перепризначається головній, безпечні прапорці об'єднуються, поглинуті
// картки видаляються. Атомарно (db.batch) і лише для повного адміністратора.
export async function POST(request: Request) {
  const db = dbBinding();
  if (!db) return Response.json({ error: "База тимчасово недоступна" }, { status: 503 });
  const ctx = await requireOrgContext(request, db);
  if (!ctx) return Response.json({ error: "Доступ лише для персоналу" }, { status: 403 });
  const member = ctx.member;
  const orgId = ctx.organizationId;
  if (!canMergePatients(member.role)) {
    return Response.json({ error: "Обʼєднувати картки може лише адміністратор" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const survivorId = String(body.survivorId || "").trim().toLowerCase();
  const absorbedRaw = Array.isArray(body.absorbedIds) ? body.absorbedIds : [];
  const absorbedIds = [...new Set(absorbedRaw.map((v) => String(v || "").trim().toLowerCase()))]
    .filter((v) => v && v !== survivorId);

  if (!PATIENT_ID_RE.test(survivorId)) {
    return Response.json({ error: "Некоректний ідентифікатор головної картки" }, { status: 400 });
  }
  if (!absorbedIds.length || absorbedIds.length > 10 || !absorbedIds.every((v) => PATIENT_ID_RE.test(v))) {
    return Response.json({ error: "Оберіть від 1 до 10 карток для приєднання" }, { status: 400 });
  }

  const allIds = [survivorId, ...absorbedIds];
  const placeholders = allIds.map(() => "?").join(",");
  const profiles = await db.prepare(
    `SELECT patient_id AS patientId, contrast_alert AS contrastAlert, do_not_contact AS doNotContact,
       allergy_note AS allergyNote, telegram_chat_id AS telegramChatId
     FROM patient_profiles WHERE organization_id = ? AND patient_id IN (${placeholders})`
  ).bind(orgId, ...allIds).all<MergeProfile>();
  const found = (profiles.results || []) as MergeProfile[];
  const survivor = found.find((p) => p.patientId === survivorId);
  if (!survivor || found.length !== allIds.length) {
    return Response.json({ error: "Деякі картки не знайдено в цій організації" }, { status: 404 });
  }
  const absorbed = found.filter((p) => p.patientId !== survivorId);
  const safety = mergeSafetyFields(survivor, absorbed);

  const absPlaceholders = absorbedIds.map(() => "?").join(",");
  const statements = [
    // 1) Перепризначаємо історію на головну картку (лінк дозволено переписати).
    ...REPOINT_TABLES.map((t) =>
      db.prepare(`UPDATE ${t} SET patient_id = ? WHERE patient_id IN (${absPlaceholders})`)
        .bind(survivorId, ...absorbedIds)),
    // 2) Прибираємо ефемерні/переустановлювані рядки поглинутих карток.
    ...PURGE_TABLES.map((t) =>
      db.prepare(`DELETE FROM ${t} WHERE patient_id IN (${absPlaceholders})`).bind(...absorbedIds)),
    // 3) Об'єднуємо безпечні поля в головній картці.
    db.prepare(
      `UPDATE patient_profiles SET contrast_alert = ?, do_not_contact = ?, allergy_note = ?,
         telegram_chat_id = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = ? AND patient_id = ?`
    ).bind(safety.contrastAlert, safety.doNotContact, safety.allergyNote, safety.telegramChatId, member.email, orgId, survivorId),
    // 4) Видаляємо поглинуті картки (заявки вже перепризначені — delete-guard пройде).
    db.prepare(`DELETE FROM patient_profiles WHERE organization_id = ? AND patient_id IN (${absPlaceholders})`)
      .bind(orgId, ...absorbedIds),
  ];

  try {
    await db.batch(statements);
  } catch {
    return Response.json({ error: "Не вдалося обʼєднати картки" }, { status: 500 });
  }

  await logSecurityEvent(db, {
    organizationId: orgId,
    actorEmail: member.email,
    action: "patients_merged",
    resource: "patient",
    targetId: survivorId,
    details: { absorbed: absorbedIds, count: absorbedIds.length },
  });

  return Response.json({ ok: true, survivorId, absorbed: absorbedIds });
}
