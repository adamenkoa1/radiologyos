// Чистий шар рішень автозбереження чернетки протоколу — без DOM, мережі чи стану.
// Детерміновані правила, які використовує редактор `/staff/protocols` і які
// покривають поведінкові тести. НЕ створює паралельного API: фактичне збереження
// йде наявним `PUT /api/staff/protocols` з optimistic locking через `baseVersion`.

export const AUTOSAVE_DELAY_MS = 1000;

export type AutosaveState = "idle" | "saving" | "saved" | "error" | "conflict";

// Автозбереження дозволене ЛИШЕ для редагованої чернетки (`draft`) і лише коли є
// реальні незбережені зміни, немає активного збереження та немає невирішеного
// конфлікту версій. Підписані/видані протоколи ніколи не автозберігаються — це не
// послаблює серверні гейти, а відповідає їм.
export function shouldAutosave(input: {
  status: string;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
}): boolean {
  return input.status === "draft" && input.dirty === true && !input.saving && !input.conflict;
}

// Після збереження лишаємось «dirty» лише тоді, коли під час запиту зʼявилась
// новіша правка (лічильник редагувань змінився). Так не губимо введений текст і
// не робимо зайвих ревізій для незміненого вмісту.
export function remainsDirtyAfterSave(editSeqAtSend: number, editSeqNow: number): boolean {
  return editSeqAtSend !== editSeqNow;
}

// 409 від сервера (optimistic lock за `baseVersion`) — конфлікт версій: когось
// випередили, тихо перезаписувати серверний текст не можна.
export function isVersionConflict(responseStatus: number): boolean {
  return responseStatus === 409;
}

// Людські україномовні стани індикатора автозбереження. Порядок пріоритету:
// активне збереження → конфлікт → помилка → є незбережені зміни → збережено.
export function autosaveLabel(state: AutosaveState, dirty: boolean): string {
  if (state === "saving") return "Збереження…";
  if (state === "conflict") return "Конфлікт версій";
  if (state === "error") return "Помилка збереження — повторимо після наступної зміни";
  if (dirty) return "Є незбережені зміни";
  if (state === "saved") return "Збережено";
  return "";
}
