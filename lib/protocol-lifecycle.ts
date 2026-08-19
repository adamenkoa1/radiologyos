import {
  bookingProtocolStatus,
  isProtocolTemplate,
  PROTOCOL_LIMITS,
  protocolTemplateByKey,
  sanitizeDocument,
  type ProtocolDocument,
  type ProtocolStatus as LegacyProtocolStatus,
} from "./protocols";

export type ProtocolLifecycleStatus = LegacyProtocolStatus | "signed";
export type ProtocolLifecycleDocument = Omit<ProtocolDocument, "status"> & { status: ProtocolLifecycleStatus };
export type ProtocolInputBoundsValidation = { ok: true } | { ok: false; error: string };

export const PROTOCOL_LIFECYCLE_STATUS_LABELS: Record<ProtocolLifecycleStatus, string> = {
  draft: "Чернетка",
  ready: "Готовий до підпису",
  signed: "Підписаний",
  issued: "Виданий пацієнту",
};

export function isProtocolLifecycleStatus(value: string): value is ProtocolLifecycleStatus {
  return value === "draft" || value === "ready" || value === "signed" || value === "issued";
}

function normalizedInputText(value: unknown): string {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function protocolInputLengthError(value: unknown, max: number, label: string): string | null {
  return normalizedInputText(value).length > max
    ? `Поле «${label}» не може перевищувати ${max} символів`
    : null;
}

// The legacy normalizer clips strings to its storage bounds. Clinical text must
// never be silently shortened, so every user-controlled persisted field is
// checked first and the request fails closed if any value is over the limit.
export function validateProtocolInputBounds(input: unknown): ProtocolInputBoundsValidation {
  if (!input || typeof input !== "object") return { ok: false, error: "Некоректні дані протоколу" };
  const raw = input as Record<string, unknown>;
  const templateKey = String(raw.templateKey || "generic");
  if (!isProtocolTemplate(templateKey)) return { ok: false, error: "Невідомий шаблон протоколу" };

  const topLevelChecks: Array<[unknown, number, string]> = [
    [raw.method, PROTOCOL_LIMITS.method, "Методика"],
    [raw.findings, PROTOCOL_LIMITS.narrative, "Опис"],
    [raw.conclusion, PROTOCOL_LIMITS.narrative, "Висновок"],
    [raw.recommendations, PROTOCOL_LIMITS.narrative, "Рекомендації"],
    [raw.number, PROTOCOL_LIMITS.number, "Номер протоколу"],
  ];
  for (const [value, max, label] of topLevelChecks) {
    const error = protocolInputLengthError(value, max, label);
    if (error) return { ok: false, error };
  }

  const incomingSections = raw.sections && typeof raw.sections === "object" && !Array.isArray(raw.sections)
    ? raw.sections as Record<string, unknown>
    : {};
  const template = protocolTemplateByKey(templateKey);
  for (const section of template.sections) {
    const incoming = incomingSections[section.key];
    const source = incoming && typeof incoming === "object" && !Array.isArray(incoming)
      ? incoming as Record<string, unknown>
      : {};
    for (const field of section.fields) {
      const error = protocolInputLengthError(source[field.key], PROTOCOL_LIMITS.field, field.label);
      if (error) return { ok: false, error };
    }
  }
  return { ok: true };
}

export function sanitizeLifecycleDocument(
  input: unknown,
): { ok: true; document: ProtocolLifecycleDocument } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Некоректні дані протоколу" };
  const raw = input as Record<string, unknown>;
  const requestedStatus = String(raw.status || "draft");
  if (!isProtocolLifecycleStatus(requestedStatus)) return { ok: false, error: "Некоректний статус протоколу" };

  const bounds = validateProtocolInputBounds(raw);
  if (!bounds.ok) return bounds;

  // The existing document sanitizer owns field normalization and the
  // number/conclusion requirements for finalized documents. Validate `signed`
  // with the same strictness as `ready`, then restore the lifecycle status.
  const parsed = sanitizeDocument({
    ...raw,
    status: requestedStatus === "signed" ? "ready" : requestedStatus,
  });
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    document: { ...parsed.document, status: requestedStatus },
  };
}

// `bookings.protocol_status` is a legacy read model with no signed state.
// A signed-but-not-delivered result remains `ready`; only delivery projects to
// `issued`, preserving current patient-cabinet and reporting semantics.
export function bookingProtocolLifecycleStatus(status: ProtocolLifecycleStatus): string {
  return status === "signed" ? "ready" : bookingProtocolStatus(status);
}
