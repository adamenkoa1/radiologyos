// Виявлення суперечностей між джерелами даних про пацієнта (за мотивами
// health-os «contradiction detection»): звіряємо картки CRM, заявки й контакти
// в межах ОДНІЄЇ організації та повертаємо перелік знахідок для реєстратури.
//
// Чиста логіка без залежностей — щоб виконуватись у тестах напряму (як
// lib/reminders-core). Читання БД — у app/api/staff/patients/issues/route.ts.

export type ConsistencyKind =
  | "stale_contact" | "duplicate_phone" | "linkable_booking" | "name_divergence";
export type ConsistencySeverity = "high" | "medium" | "low";

export interface ConsistencyMember {
  patientId: string;
  displayName: string;
  birthDate: string;
}

export interface ConsistencyFinding {
  kind: ConsistencyKind;
  severity: ConsistencySeverity;
  patientId: string;
  bookingId: number | null;
  code: string;
  phoneNormalized: string;
  title: string;
  detail: string;
  suggestion: string;
  // Заповнюється лише для duplicate_phone — картки, що ділять номер (для злиття).
  members?: ConsistencyMember[];
}

// Нормалізація ПІБ для порівняння: нижній регістр, без пунктуації, згорнуті
// пробіли. Порядок слів не важить (Прізвище Ім'я vs Ім'я Прізвище).
export function normalizeName(value: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function namesDiverge(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false; // нема що звіряти
  if (na === nb) return false;
  const sortedWords = (s: string) => s.split(" ").sort().join(" ");
  return sortedWords(na) !== sortedWords(nb);
}

export interface StaleContactRow {
  bookingId: number; code: string; bookingName: string; bookingPhone: string;
  patientId: string; displayName: string; profilePhone: string;
}
export function staleContactFindings(rows: StaleContactRow[]): ConsistencyFinding[] {
  return rows.map((r) => ({
    kind: "stale_contact", severity: "high",
    patientId: r.patientId, bookingId: r.bookingId, code: r.code, phoneNormalized: r.profilePhone,
    title: `Телефон у заявці не збігається з карткою: ${r.displayName || "без імені"}`,
    detail: `Заявка ${r.code}: ${r.bookingPhone || "—"}; картка: ${r.profilePhone || "—"}.`,
    suggestion: "Звірте актуальний номер і оновіть картку або заявку. Поки контакти різняться, планові нагадування для цього запису пропускаються.",
  }));
}

export interface DuplicatePhoneMember {
  phoneNormalized: string; patientId: string; displayName: string; birthDate: string;
}
// Групуємо картки за номером; знахідка — на кожен номер із ≥2 картками.
export function duplicatePhoneFindings(members: DuplicatePhoneMember[]): ConsistencyFinding[] {
  const groups = new Map<string, ConsistencyMember[]>();
  for (const m of members) {
    if (!m.phoneNormalized) continue;
    const list = groups.get(m.phoneNormalized) || [];
    list.push({ patientId: m.patientId, displayName: m.displayName, birthDate: m.birthDate });
    groups.set(m.phoneNormalized, list);
  }
  const out: ConsistencyFinding[] = [];
  for (const [phone, list] of groups) {
    if (list.length < 2) continue;
    const names = list.map((m) => m.displayName || "без імені").join(" | ");
    out.push({
      kind: "duplicate_phone", severity: "medium",
      patientId: "", bookingId: null, code: "", phoneNormalized: phone,
      title: `Один номер у ${list.length} карток`,
      detail: `${phone}: ${names}.`,
      suggestion: "Якщо це та сама людина — оберіть головну картку й обʼєднайте; якщо родина ділить номер — залиште окремі, але переконайтесь, що історії не переплутано.",
      members: list,
    });
  }
  return out;
}

export interface MergeProfile {
  patientId: string; contrastAlert: number; doNotContact: number;
  allergyNote: string; telegramChatId: string;
}
// Об'єднання КЛІНІЧНО-безпечних полів при злитті карток: жоден прапорець
// «контраст»/«не турбувати» й жодна нотатка алергій НЕ втрачаються. Демографію
// (ПІБ, дата народження тощо) визначає головна картка — тут не чіпаємо.
export function mergeSafetyFields(survivor: MergeProfile, absorbed: MergeProfile[]): {
  contrastAlert: number; doNotContact: number; allergyNote: string; telegramChatId: string;
} {
  const all = [survivor, ...absorbed];
  const contrastAlert = all.some((p) => Number(p.contrastAlert) === 1) ? 1 : 0;
  const doNotContact = all.some((p) => Number(p.doNotContact) === 1) ? 1 : 0;
  const notes: string[] = [];
  for (const p of all) {
    const n = (p.allergyNote || "").trim();
    if (n && !notes.some((x) => x.toLowerCase() === n.toLowerCase())) notes.push(n);
  }
  const allergyNote = notes.join(" / ").slice(0, 400);
  const telegramChatId = (survivor.telegramChatId || "").trim()
    || absorbed.map((p) => (p.telegramChatId || "").trim()).find(Boolean) || "";
  return { contrastAlert, doNotContact, allergyNote, telegramChatId };
}

export interface LinkableBookingRow {
  bookingId: number; code: string; bookingName: string;
  phoneNormalized: string; patientId: string; displayName: string;
}
export function linkableBookingFindings(rows: LinkableBookingRow[]): ConsistencyFinding[] {
  return rows.map((r) => ({
    kind: "linkable_booking", severity: "low",
    patientId: r.patientId, bookingId: r.bookingId, code: r.code, phoneNormalized: r.phoneNormalized,
    title: `Заявка без картки збігається з пацієнтом: ${r.displayName || "без імені"}`,
    detail: `Заявку ${r.code} (${r.bookingName || "без імені"}) можна привʼязати до картки за номером ${r.phoneNormalized}.`,
    suggestion: "Відкрийте картку й перевірте, чи це той самий пацієнт, перш ніж зводити історію.",
  }));
}

export interface NameDivergenceRow {
  bookingId: number; code: string; bookingName: string;
  patientId: string; displayName: string; phoneNormalized: string;
}
export function nameDivergenceFindings(rows: NameDivergenceRow[]): ConsistencyFinding[] {
  const out: ConsistencyFinding[] = [];
  for (const r of rows) {
    if (!namesDiverge(r.bookingName, r.displayName)) continue;
    out.push({
      kind: "name_divergence", severity: "medium",
      patientId: r.patientId, bookingId: r.bookingId, code: r.code, phoneNormalized: r.phoneNormalized,
      title: "Різні ПІБ у заявці й картці",
      detail: `Заявка ${r.code}: «${r.bookingName}»; картка: «${r.displayName}».`,
      suggestion: "Переконайтесь, що заявку привʼязано до правильної картки, і зведіть написання ПІБ.",
    });
  }
  return out;
}

const SEVERITY_ORDER: Record<ConsistencySeverity, number> = { high: 0, medium: 1, low: 2 };

export function sortFindings(findings: ConsistencyFinding[]): ConsistencyFinding[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function countFindings(findings: ConsistencyFinding[]): {
  high: number; medium: number; low: number; total: number;
} {
  let high = 0, medium = 0, low = 0;
  for (const f of findings) {
    if (f.severity === "high") high += 1;
    else if (f.severity === "medium") medium += 1;
    else low += 1;
  }
  return { high, medium, low, total: findings.length };
}
