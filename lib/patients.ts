import { serviceByCode } from "./catalog";
import { normalizeUkrainianPhone } from "./phone";
import { normalizeDob } from "./dob";

// CRM aggregation has two modes during the patient-id migration:
// - the legacy list/card remains phone-grouped for backwards compatibility;
// - exact patient-id reads aggregate only bookings explicitly linked to one
//   immutable patient profile. Unlinked historical bookings are never inferred
//   to belong to a profile from phone/DOB similarity.

export type PatientBookingRow = {
  id:number; code:string; name:string; phoneNormalized:string; patientId:string;
  service:string; serviceCode:string; equipmentId:string;
  desiredDate:string; desiredTime:string; status:string;
  patientCategory:string; marketingSource:string;
  protocolStatus:string; paymentStatus:string; paymentAmount:number; paidAmount:number;
  performedAt:string; createdAt:string;
};

export type PatientProfile = {
  patientId?:string;
  phoneNormalized:string; displayName:string; birthYear:number;
  birthDate:string; email:string; address:string;
  tags:string; notes:string; doNotContact:number; updatedBy:string; updatedAt:string;
};

export type PatientSummary = {
  patientId:string; phoneNormalized:string; name:string; category:string;
  visits:number; completed:number; cancelled:number; upcoming:number;
  firstVisit:string; lastVisit:string;
  awaitingProtocol:number; outstanding:number; dueTotal:number; paidTotal:number;
  marketingSource:string; tags:string; doNotContact:boolean; hasProfile:boolean;
};

export type PatientSegment =
  "all" | "repeat" | "upcoming" | "awaiting_protocol" | "outstanding_payment" | "do_not_contact";

export const COMMUNICATION_CHANNELS = ["call", "sms", "viber", "telegram", "email", "in_person", "other"] as const;
export const COMMUNICATION_DIRECTIONS = ["outbound", "inbound"] as const;

export const CHANNEL_LABELS: Record<string,string> = {
  call:"Дзвінок", sms:"SMS", viber:"Viber", telegram:"Telegram",
  email:"Email", in_person:"Особисто", other:"Інше",
};
export const DIRECTION_LABELS: Record<string,string> = {
  outbound:"Вихідна", inbound:"Вхідна",
};
export const SEGMENT_LABELS: Record<PatientSegment,string> = {
  all:"Усі пацієнти",
  repeat:"Повторні",
  upcoming:"Майбутні візити",
  awaiting_protocol:"Очікують протокол",
  outstanding_payment:"Борг оплати",
  do_not_contact:"Не турбувати",
};

const activeUpcoming = new Set(["new", "confirmed", "rescheduled"]);

function listedDue(row:PatientBookingRow) {
  return Number(row.paymentAmount) || serviceByCode(row.serviceCode)?.price || 0;
}

function isOutstanding(row:PatientBookingRow) {
  return row.patientCategory === "civilian"
    && row.status !== "cancelled"
    && !["paid", "not_required"].includes(row.paymentStatus);
}

function summarizePatientRows(
  rows: PatientBookingRow[],
  profile: PatientProfile | undefined,
  fallbackPhone: string,
): PatientSummary {
  const chronological = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latest = chronological[chronological.length - 1];
  const dates = rows.map((row) => row.desiredDate).filter(Boolean).sort();
  const marketing = [...chronological].reverse().find((row) => row.marketingSource)?.marketingSource || "";
  const phoneNormalized = profile?.phoneNormalized || fallbackPhone || latest?.phoneNormalized || "";

  return {
    patientId:profile?.patientId || "",
    phoneNormalized,
    name:(profile?.displayName || latest?.name || "").trim(),
    category:latest?.patientCategory || "",
    visits:rows.length,
    completed:rows.filter((row) => row.status === "completed").length,
    cancelled:rows.filter((row) => row.status === "cancelled").length,
    upcoming:rows.filter((row) => activeUpcoming.has(row.status)).length,
    firstVisit:dates[0] || "",
    lastVisit:dates[dates.length - 1] || "",
    awaitingProtocol:rows.filter((row) => row.performedAt && !["ready", "issued"].includes(row.protocolStatus)).length,
    outstanding:rows.filter(isOutstanding).length,
    dueTotal:rows.filter(isOutstanding).reduce((sum, row) => sum + listedDue(row), 0),
    paidTotal:rows.filter((row) => row.paymentStatus === "paid").reduce((sum, row) => sum + Number(row.paidAmount || 0), 0),
    marketingSource:marketing,
    tags:profile?.tags || "",
    doNotContact:!!profile?.doNotContact,
    hasProfile:!!profile,
  };
}

// Legacy list mode: keep grouping by normalized phone until the UI is migrated
// to exact profile selection. Profiles carry patientId so the client can move
// to the exact path without making phone the future identity key.
export function buildPatientSummaries(
  bookings:PatientBookingRow[],
  profiles:Map<string,PatientProfile>,
):PatientSummary[] {
  const groups = new Map<string,PatientBookingRow[]>();
  for (const row of bookings) {
    const key = row.phoneNormalized;
    if (!key) continue;
    (groups.get(key) || groups.set(key, []).get(key)!).push(row);
  }

  const summaries:PatientSummary[] = [];
  for (const [phone, rows] of groups) {
    summaries.push(summarizePatientRows(rows, profiles.get(phone), phone));
  }

  // Пацієнти, додані вручну (профіль без жодної заявки) — теж у списку.
  for (const [phone, profile] of profiles) {
    if (groups.has(phone)) continue;
    summaries.push(summarizePatientRows([], profile, phone));
  }

  return summaries.sort((a, b) => (b.lastVisit || "").localeCompare(a.lastVisit || "") || a.name.localeCompare(b.name));
}

// Exact identity mode: callers must already have selected a patient profile by
// immutable patientId. Every booking supplied here must have been explicitly
// linked to that patient; phone snapshots are not used as membership evidence.
export function buildExactPatientSummary(
  bookings: PatientBookingRow[],
  profile: PatientProfile,
): PatientSummary {
  return summarizePatientRows(bookings, profile, profile.phoneNormalized);
}

export function matchesSegment(summary:PatientSummary, segment:PatientSegment):boolean {
  switch (segment) {
    case "repeat": return summary.visits > 1;
    case "upcoming": return summary.upcoming > 0;
    case "awaiting_protocol": return summary.awaitingProtocol > 0;
    case "outstanding_payment": return summary.outstanding > 0;
    case "do_not_contact": return summary.doNotContact;
    default: return true;
  }
}

export function segmentCounts(summaries:PatientSummary[]):Record<PatientSegment,number> {
  const segments = Object.keys(SEGMENT_LABELS) as PatientSegment[];
  const counts = {} as Record<PatientSegment,number>;
  for (const segment of segments) counts[segment] = summaries.filter((item) => matchesSegment(item, segment)).length;
  return counts;
}

export type ProfileValidation =
  | { ok:true; profile:{ phoneNormalized:string; displayName:string; birthYear:number; birthDate:string; email:string; address:string; tags:string; notes:string; doNotContact:number } }
  | { ok:false; error:string };

export function sanitizeProfile(input:unknown):ProfileValidation {
  if (!input || typeof input !== "object") return { ok:false, error:"Некоректні дані пацієнта" };
  const raw = input as Record<string,unknown>;
  const phoneNormalized = normalizeUkrainianPhone(String(raw.phone ?? raw.phoneNormalized ?? ""));
  if (!phoneNormalized) return { ok:false, error:"Некоректний номер телефону пацієнта" };
  const displayName = String(raw.displayName ?? "").trim().slice(0, 120);
  const tags = String(raw.tags ?? "").trim().slice(0, 200);
  const notes = String(raw.notes ?? "").trim().slice(0, 2000);
  const address = String(raw.address ?? "").trim().slice(0, 200);
  const emailRaw = String(raw.email ?? "").trim().toLowerCase().slice(0, 254);
  if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
    return { ok:false, error:"Некоректний email пацієнта" };
  }
  const doNotContact = raw.doNotContact === true || raw.doNotContact === 1 || raw.doNotContact === "true" ? 1 : 0;
  // Повна дата народження (необовʼязково); рік для сумісності похідний від неї.
  const birthDate = normalizeDob(raw.birthDate);
  if (raw.birthDate && !birthDate) return { ok:false, error:"Некоректна дата народження" };
  let birthYear = birthDate ? Number(birthDate.slice(0, 4)) : (Number(raw.birthYear) || 0);
  if (birthYear !== 0 && (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > 2100)) {
    return { ok:false, error:"Рік народження вкажіть у форматі РРРР" };
  }
  birthYear = birthYear || 0;
  return { ok:true, profile:{ phoneNormalized, displayName, birthYear, birthDate, email:emailRaw, address, tags, notes, doNotContact } };
}

export type CommunicationValidation =
  | { ok:true; communication:{ phoneNormalized:string; channel:string; direction:string; summary:string } }
  | { ok:false; error:string };

export function sanitizeCommunication(input:unknown):CommunicationValidation {
  if (!input || typeof input !== "object") return { ok:false, error:"Некоректні дані звернення" };
  const raw = input as Record<string,unknown>;
  const phoneNormalized = normalizeUkrainianPhone(String(raw.phone ?? raw.phoneNormalized ?? ""));
  if (!phoneNormalized) return { ok:false, error:"Некоректний номер телефону пацієнта" };
  const channel = String(raw.channel ?? "");
  const direction = String(raw.direction ?? "");
  const summary = String(raw.summary ?? "").trim().slice(0, 1000);
  if (!(COMMUNICATION_CHANNELS as readonly string[]).includes(channel)) return { ok:false, error:"Оберіть канал звернення" };
  if (!(COMMUNICATION_DIRECTIONS as readonly string[]).includes(direction)) return { ok:false, error:"Оберіть напрям звернення" };
  if (!summary) return { ok:false, error:"Опишіть зміст звернення" };
  return { ok:true, communication:{ phoneNormalized, channel, direction, summary } };
}
