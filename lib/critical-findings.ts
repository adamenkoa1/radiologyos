// Критичні знахідки: статуси, підписи, санітизація вводу. Чиста логіка без
// залежностей (напряму тестовна). Робота з БД — у маршруті.

export type CriticalStatus = "open" | "communicated" | "resolved";

export const CRITICAL_STATUSES: CriticalStatus[] = ["open", "communicated", "resolved"];

export const CRITICAL_STATUS_LABELS: Record<CriticalStatus, string> = {
  open: "Потребує доведення",
  communicated: "Доведено",
  resolved: "Закрито",
};

export function isCriticalStatus(value: string): value is CriticalStatus {
  return (CRITICAL_STATUSES as string[]).includes(value);
}

export const NOTE_MAX = 1000;
export const VIA_MAX = 80;

export function sanitizeNote(value: unknown): string {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, NOTE_MAX);
}

export function sanitizeVia(value: unknown): string {
  return String(value ?? "").trim().slice(0, VIA_MAX);
}

// Дозволені переходи статусу (open → communicated → resolved; повернень нема).
export function canTransition(from: CriticalStatus, to: CriticalStatus): boolean {
  if (from === "open") return to === "communicated" || to === "resolved";
  if (from === "communicated") return to === "resolved";
  return false;
}
