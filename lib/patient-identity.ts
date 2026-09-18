// Доказ особи пацієнта за телефоном + датою народження (без коду заявки).
//
// Спільна логіка для двох шляхів входу:
//  • /api/patient-otp — надсилає одноразовий код на пошту/SMS (фактор володіння);
//  • /api/patient-login — знання-фактор (телефон + ДН [+ опційно номер заявки]).
//
// Fail-closed за замовчуванням: телефон може належати кільком людям (спільний
// сімейний номер, близнюки, збіг ДН, змішані історичні записи). Без незмінного
// patient_id більш ніж один запис — це неоднозначність, і ми НЕ припускаємо, що
// вони належать одній особі. Такі випадки повертають "ambiguous", а виклик
// вимагає точнішого доказу (номера заявки).

export type DobProofResult =
  | { status: "ok"; patientId: string }
  | { status: "none" }
  | { status: "ambiguous" };

export async function provePatientDobIdentity(
  db: D1Database,
  organizationId: number,
  phoneNormalized: string,
  dob: string,
): Promise<DobProofResult> {
  if (!phoneNormalized || !dob) return { status: "none" };

  const summary = await db.prepare(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN b.patient_id != '' THEN 1 ELSE 0 END) AS linkedCount,
       COUNT(DISTINCT CASE WHEN b.patient_id != '' THEN b.patient_id END) AS patientCount,
       MAX(CASE WHEN b.patient_id != '' THEN b.patient_id ELSE '' END) AS patientId,
       SUM(CASE
         WHEN b.patient_id != '' AND COALESCE(p.phone_normalized, '') = ? THEN 1
         ELSE 0
       END) AS currentPhoneCount
     FROM bookings b
     LEFT JOIN patient_profiles p
       ON p.organization_id = b.organization_id AND p.patient_id = b.patient_id
     WHERE b.organization_id = ? AND b.phone_normalized = ? AND b.date_of_birth = ?`,
  ).bind(phoneNormalized, organizationId, phoneNormalized, dob).first<{
    total: number;
    linkedCount: number;
    patientCount: number;
    patientId: string;
    currentPhoneCount: number;
  }>();

  const total = Number(summary?.total || 0);
  if (!total) return { status: "none" };

  const linkedCount = Number(summary?.linkedCount || 0);
  // Один незмінний пацієнт покриває всі записи (усі привʼязані до одного
  // profile, чий поточний телефон збігається) — однозначно.
  const exact = linkedCount === total
    && Number(summary?.patientCount || 0) === 1
    && Number(summary?.currentPhoneCount || 0) === linkedCount
    && !!summary?.patientId;
  if (exact) return { status: "ok", patientId: summary.patientId };

  // Єдиний непривʼязаний (легасі) запис — теж однозначно: сесія на dob, а
  // patientSessionScopeIsUnambiguous далі бачить рівно один запис.
  if (total === 1 && linkedCount === 0) return { status: "ok", patientId: "" };

  // Усе інше — кілька записів, змішані профілі або змінений телефон: не
  // припускаємо, що це одна особа. Потрібен точніший доказ (номер заявки).
  return { status: "ambiguous" };
}
