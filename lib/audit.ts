// Журнал дій (аудит безпеки): хто, що і коли зробив. Пишеться для чутливих
// подій; читає лише адміністратор. Записи скоупляться за організацією.

export type AuditEvent = {
  organizationId: number;
  actorEmail: string;
  action: string;   // машинний код події, напр. "login", "booking_confirm"
  resource: string; // домен, напр. "auth", "booking", "settings", "staff"
  targetId?: string | number;
  details?: Record<string, unknown>;
};

export type AuditRow = {
  id: number;
  actorEmail: string;
  action: string;
  resource: string;
  targetId: string;
  detailsJson: string;
  createdAt: string;
};

// Людські підписи подій — спільні для сервера й UI (через /api/staff/audit).
export const AUDIT_LABELS: Record<string, string> = {
  login: "Вхід у систему",
  login_failed: "Невдала спроба входу",
  logout: "Вихід із системи",
  schedule_update: "Змінено графік і слоти",
  settings_update: "Змінено налаштування",
  org_profile_update: "Змінено профіль організації",
  pacs_update: "Змінено налаштування PACS",
  imaging_study_viewed: "Переглянуто медичні зображення",
  booking_confirm: "Підтверджено запис",
  booking_cancel: "Скасовано запис",
  booking_reschedule: "Перенесено запис",
  member_add: "Додано співробітника",
  member_role: "Змінено роль співробітника",
  member_password: "Скинуто PIN співробітника",
  patient_record_viewed: "Переглянуто картку пацієнта",
  patient_registry_viewed: "Переглянуто реєстр пацієнтів",
  patient_contacts_exported: "Експортовано контакти пацієнтів",
  patients_imported: "Імпортовано пацієнтів",
  protocol_viewed: "Переглянуто протокол",
  protocol_revision_viewed: "Переглянуто версію протоколу",
  protocol_addenda_viewed: "Переглянуто виправлення до протоколу",
  protocol_saved: "Збережено протокол",
  protocol_issued: "Видано протокол",
  contact_center_thread_viewed: "Переглянуто діалог контакт-центру",
  result_delivery_queue_viewed: "Переглянуто чергу видачі результатів",
  study_context_viewed: "Переглянуто контекст дослідження",
  patient_protocol_viewed: "Пацієнт переглянув протокол",
  profile_update: "Змінено профіль співробітника",
  profile_security_update: "Змінено параметри безпеки профілю",
  personnel_registry_viewed: "Переглянуто кадровий довідник",
  personnel_created: "Створено кадрову картку",
  personnel_updated: "Оновлено кадрову картку",
  personnel_vlk_viewed: "Переглянуто історію ВЛК працівника",
  personnel_vlk_recorded: "Додано рішення ВЛК працівника",
  personnel_radiation_clearance_viewed: "Переглянуто історію допусків працівника до ДІВ",
  personnel_radiation_clearance_recorded: "Додано рішення щодо допуску працівника до ДІВ",
  personnel_radiation_training_viewed: "Переглянуто історію навчання працівника з радіаційної безпеки",
  personnel_radiation_training_recorded: "Додано запис навчання працівника з радіаційної безпеки",
  personnel_dosimetry_viewed: "Переглянуто індивідуальну дозиметрію працівника",
  personnel_dosimetry_recorded: "Додано результат індивідуальної дозиметрії працівника",
  personnel_radiation_compliance_viewed: "Переглянуто зведення радіаційної безпеки персоналу",
  personnel_radiation_review_policy_viewed: "Переглянуто політику review радіаційної безпеки",
  personnel_radiation_review_policy_recorded: "Додано ревізію політики review радіаційної безпеки",
  report_viewed: "Переглянуто звіт",
  report_exported: "Експортовано звіт",
  service_material_requirement_created: "Створено норму матеріалів",
  service_material_requirement_deactivated: "Деактивовано норму матеріалів",
};

export function auditLabel(action: string): string {
  return AUDIT_LABELS[action] || action;
}

export async function logSecurityEvent(db: D1Database, event: AuditEvent): Promise<void> {
  const organizationId = Number(event.organizationId);
  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    throw new Error("security audit requires a valid organizationId");
  }
  const details = JSON.stringify(event.details || {}).slice(0, 4000);
  await db.prepare(
    `INSERT INTO security_audit_log
       (organization_id, actor_email, action, resource, target_id, details_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    organizationId,
    String(event.actorEmail || "").slice(0, 254),
    event.action.slice(0, 80),
    event.resource.slice(0, 80),
    String(event.targetId ?? "").slice(0, 120),
    details,
  ).run();
}

// Безпечна обгортка: аудит НІКОЛИ не валить основну операцію — помилки
// запису журналу ковтаються всередині.
export async function audit(db: D1Database, event: AuditEvent): Promise<void> {
  try { await logSecurityEvent(db, event); } catch { /* аудит не блокує дію */ }
}

export type AuditQuery = { action?: string; actor?: string; limit?: number; beforeId?: number };

// Читання журналу для організації з фільтрами й keyset-пагінацією за id.
export async function listAuditEvents(db: D1Database, organizationId: number, q: AuditQuery = {}): Promise<AuditRow[]> {
  const where: string[] = ["organization_id = ?"];
  const binds: (string | number)[] = [organizationId];
  if (q.action) { where.push("action = ?"); binds.push(q.action.slice(0, 80)); }
  if (q.actor) { where.push("actor_email LIKE ?"); binds.push(`%${q.actor.slice(0, 120)}%`); }
  if (q.beforeId && Number.isFinite(q.beforeId)) { where.push("id < ?"); binds.push(q.beforeId); }
  // Стеля 200 для UI-пагінації; до 5000 для CSV-експорту.
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 5000);
  const rows = await db.prepare(
    `SELECT id, actor_email AS actorEmail, action, resource, target_id AS targetId,
            details_json AS detailsJson, created_at AS createdAt
     FROM security_audit_log
     WHERE ${where.join(" AND ")}
     ORDER BY id DESC
     LIMIT ?`
  ).bind(...binds, limit).all<AuditRow>();
  return rows.results;
}

// Екранування значення для CSV (RFC 4180) + нейтралізація формул: клітинку,
// що починається з = + - @ (або tab/CR), префіксуємо апострофом, щоб Excel/
// LibreOffice не виконали її як формулу (CSV injection). Лапки від цього не
// рятують — редактор їх знімає перед обчисленням.
function csvCell(value: unknown): string {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Журнал → CSV (з BOM для коректного відкриття в Excel). Дата — UTC, як у БД.
export function toAuditCsv(rows: AuditRow[], labels: Record<string, string> = AUDIT_LABELS): string {
  const header = ["Дата (UTC)", "Код події", "Подія", "Ресурс", "Хто", "Обʼєкт", "Деталі"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push([
      r.createdAt, r.action, labels[r.action] || r.action,
      r.resource, r.actorEmail, r.targetId, r.detailsJson,
    ].map(csvCell).join(","));
  }
  return "﻿" + lines.join("\r\n");
}
