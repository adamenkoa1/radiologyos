import {
  bookingProtocolStatus,
  sanitizeDocument,
  type ProtocolDocument,
  type ProtocolStatus as LegacyProtocolStatus,
} from "./protocols";

export type ProtocolLifecycleStatus = LegacyProtocolStatus | "signed";
export type ProtocolLifecycleDocument = Omit<ProtocolDocument, "status"> & { status: ProtocolLifecycleStatus };

export const PROTOCOL_LIFECYCLE_STATUS_LABELS: Record<ProtocolLifecycleStatus, string> = {
  draft: "Чернетка",
  ready: "Готовий до підпису",
  signed: "Підписаний",
  issued: "Виданий пацієнту",
};

export function isProtocolLifecycleStatus(value: string): value is ProtocolLifecycleStatus {
  return value === "draft" || value === "ready" || value === "signed" || value === "issued";
}

export function sanitizeLifecycleDocument(
  input: unknown,
): { ok: true; document: ProtocolLifecycleDocument } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Некоректні дані протоколу" };
  const raw = input as Record<string, unknown>;
  const requestedStatus = String(raw.status || "draft");
  if (!isProtocolLifecycleStatus(requestedStatus)) return { ok: false, error: "Некоректний статус протоколу" };

  // The existing document sanitizer already owns all field bounds and the
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
