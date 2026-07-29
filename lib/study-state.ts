// Єдина state machine дослідження (server-side, deny-by-default).
//
// Це єдине джерело правди про життєвий цикл дослідження. Клінічний шлях:
//   requested → needs_verification → scheduled → confirmed → arrived →
//   queued → in_progress → performed → images_ready → reporting →
//   protocol_ready → issued → completed
// плюс термінальні cancelled / no_show.
//
// Сумісність: діючий персональний UI оперує спрощеним набором станів
// (new, confirmed, rescheduled, completed, cancelled). Щоб нічого не зламати,
// ці legacy-стани лишаються повноправними, а перехід між ними — вільним.
// Посилення (прибрати вільні legacy-переходи) — окремий крок hardening за
// погодженням (див. ADR 0001). Будь-який перехід, відсутній у мапі, —
// заборонено.

// Канонічні клінічні стани у порядку прогресу.
export const STUDY_STATES = [
  "requested",
  "needs_verification",
  "scheduled",
  "confirmed",
  "arrived",
  "queued",
  "in_progress",
  "performed",
  "images_ready",
  "reporting",
  "protocol_ready",
  "issued",
  "completed",
  "cancelled",
  "no_show",
] as const;

export type StudyState = (typeof STUDY_STATES)[number];

// Legacy-стани діючого UI (не входять до канонічного переліку, але визнаються).
export const LEGACY_STATES = ["new", "rescheduled"] as const;
export type LegacyState = (typeof LEGACY_STATES)[number];

export type AnyState = StudyState | LegacyState;

export const STUDY_STATE_LABELS: Record<AnyState, string> = {
  requested: "Заявка",
  needs_verification: "Потребує перевірки",
  scheduled: "Заплановано",
  confirmed: "Підтверджено",
  arrived: "Прибув",
  queued: "У черзі",
  in_progress: "Виконується",
  performed: "Виконано",
  images_ready: "Зображення готові",
  reporting: "Опис",
  protocol_ready: "Протокол готовий",
  issued: "Видано",
  completed: "Завершено",
  cancelled: "Скасовано",
  no_show: "Неявка",
  new: "Нова",
  rescheduled: "Перенесено",
};

// Термінальні стани — далі рухатися нікуди (крім явного повторного циклу).
export const TERMINAL_STATES: ReadonlySet<AnyState> = new Set(["completed", "cancelled"]);

// Legacy-набір, який діючий персональний UI дозволяє виставляти вручну.
const LEGACY_SETTABLE: AnyState[] = ["new", "confirmed", "rescheduled", "completed", "cancelled"];

// Мапа дозволених переходів. Клінічний шлях + вхід у нього з confirmed/scheduled;
// legacy-стани повністю зв'язані між собою заради сумісності.
export const TRANSITIONS: Record<AnyState, AnyState[]> = {
  // Вхідні / планування.
  new: [...LEGACY_SETTABLE, "needs_verification", "scheduled", "arrived"],
  requested: ["needs_verification", "scheduled", "cancelled"],
  needs_verification: ["scheduled", "cancelled"],
  scheduled: ["confirmed", "rescheduled", "cancelled", "no_show"],
  confirmed: [...LEGACY_SETTABLE, "arrived", "no_show"],
  rescheduled: [...LEGACY_SETTABLE, "scheduled"],
  // Клінічний прогрес.
  arrived: ["queued", "cancelled", "no_show"],
  queued: ["in_progress", "cancelled"],
  in_progress: ["performed", "cancelled"],
  performed: ["images_ready", "cancelled"],
  images_ready: ["reporting"],
  reporting: ["protocol_ready"],
  protocol_ready: ["issued"],
  issued: ["completed"],
  // Термінальні (legacy лишаються зв'язаними; no_show можна перепланувати).
  completed: [...LEGACY_SETTABLE],
  cancelled: [...LEGACY_SETTABLE],
  no_show: ["scheduled", "cancelled"],
};

export function isStudyState(value: string): value is AnyState {
  return value in STUDY_STATE_LABELS;
}

export function isTerminal(state: string): boolean {
  return TERMINAL_STATES.has(state as AnyState);
}

// Дозволені наступні стани (без самоповтору).
export function nextStates(from: string): AnyState[] {
  if (!isStudyState(from)) return [];
  return TRANSITIONS[from] ?? [];
}

// Deny-by-default: перехід дозволено лише якщо він явно є у мапі. Перехід у той
// самий стан (no-op) дозволено, щоб повторне збереження не давало помилки.
export function canTransition(from: string, to: string): boolean {
  if (!isStudyState(to)) return false;
  if (from === to) return true;
  if (!isStudyState(from)) return false;
  return (TRANSITIONS[from] ?? []).includes(to as AnyState);
}

export function stateLabel(state: string): string {
  return isStudyState(state) ? STUDY_STATE_LABELS[state] : state;
}
