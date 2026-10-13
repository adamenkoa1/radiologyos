import { AI_DISCLAIMER, generateProtocolDraft, type DraftContext, type ProtocolDraft } from "./ai";
import { renderProtocolText, type ProtocolDocument } from "./protocols";

// Абстракція AI-провайдера для конструктора протоколів (MASTER PROMPT 3, E5).
//
// Мета: єдина типізована межа, за якою може стояти або детермінований offline-
// двигун (типово), або mock (для тестів), або — у майбутньому, за окремим
// рішенням власника й затвердженою конфігурацією — зовнішній LLM. Цей модуль
// НЕ робить мережевих викликів і НЕ містить зовнішнього провайдера. Увімкнення
// зовнішнього провайдера — свідомий окремий крок (прапорець + egress-політика).
//
// Інваріанти безпеки AI (E4) — забезпечуються тут і в маршруті, не на розсуд
// провайдера:
export const AI_INVARIANTS = [
  "AI не підписує протоколи.",
  "AI не видає результати пацієнтам.",
  "AI не змінює підписані протоколи.",
  "AI не змінює статус дослідження самостійно.",
  "AI не вигадує знахідки, діагнози чи вимірювання (лише переформульовує надане).",
  "Кожна AI-пропозиція приймається або відхиляється лікарем.",
  "Прийняті зміни проходять звичайний механізм збереження та ревізій.",
  "Усі AI-операції журналюються в аудиті.",
  "При недоступності AI звичайний конструктор працює без змін.",
  "Дані пацієнта не передаються зовнішнім моделям без правової підстави та затвердженої конфігурації.",
] as const;

export type AiProviderName = "disabled" | "heuristic" | "mock";

export type AiDraftResult =
  | { ok: true; provider: AiProviderName; draft: ProtocolDraft }
  | { ok: false; provider: AiProviderName; reason: string };

export type AiProvider = {
  name: AiProviderName;
  // Чи доступний провайдер (disabled → false, решта offline → true).
  available: boolean;
  // Чи може робити мережеві виклики (усі наявні — ні).
  external: boolean;
  draft(document: ProtocolDocument, context?: DraftContext): AiDraftResult;
};

// Типово: детермінований offline-двигун (наявний generateProtocolDraft).
export const heuristicAiProvider: AiProvider = {
  name: "heuristic",
  available: true,
  external: false,
  draft(document, context = {}) {
    return { ok: true, provider: "heuristic", draft: generateProtocolDraft(document, context) };
  },
};

// Детермінований mock для тестів абстракції — без жодних зовнішніх викликів.
export const mockAiProvider: AiProvider = {
  name: "mock",
  available: true,
  external: false,
  draft() {
    return {
      ok: true,
      provider: "mock",
      draft: {
        engine: "mock",
        conclusion: "[mock] проєкт висновку для перевірки лікарем",
        recommendations: "",
        deviations: [],
        reviewedFieldCount: 0,
        disclaimer: AI_DISCLAIMER,
      },
    };
  },
};

// Повністю вимкнений AI — конструктор має працювати без нього (E4.9).
export const disabledAiProvider: AiProvider = {
  name: "disabled",
  available: false,
  external: false,
  draft() {
    return { ok: false, provider: "disabled", reason: "AI-функції вимкнено" };
  },
};

export type AiConfig = {
  // Прапорець провайдера. Типово — offline heuristic. Невідоме значення →
  // disabled (fail-safe). Зовнішні провайдери тут навмисно відсутні.
  provider?: string;
  // Явний дозвіл на зовнішній egress. Наразі не впливає (зовнішніх провайдерів
  // немає); лишено як обов'язкову умову для майбутнього увімкнення.
  externalAllowed?: boolean;
};

// Вибір провайдера з конфігурації. НІКОЛИ не повертає зовнішнього провайдера
// (їх немає); типово — offline heuristic; "disabled"/"off"/невідоме → disabled.
export function resolveAiProvider(config: AiConfig = {}): AiProvider {
  const name = (config.provider || "heuristic").toLowerCase();
  if (name === "mock") return mockAiProvider;
  if (name === "heuristic") return heuristicAiProvider;
  // off / disabled / будь-що невідоме → вимкнено (fail-safe, конструктор працює).
  return disabledAiProvider;
}

// Межа контексту + захист від prompt-injection і витоку ідентифікаторів.
// Застосовується ПЕРЕД будь-якою передачею тексту провайдеру (особливо
// зовнішньому в майбутньому): обрізає обсяг і прибирає явні PII-патерни.
export const AI_CONTEXT_MAX_CHARS = 8000;
export function sanitizeAiContext(document: ProtocolDocument): string {
  let text = renderProtocolText(document);
  // Прибираємо телефони, e-mail і довгі цифрові ідентифікатори (ПІБ у шаблоні
  // не зберігається; це додатковий запобіжник).
  text = text
    .replace(/\+?\d[\d ()-]{8,}\d/g, "[вилучено]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[вилучено]")
    .replace(/\b\d{6,}\b/g, "[вилучено]");
  // Нейтралізуємо спроби інструкцій у довільному тексті (prompt injection).
  text = text.replace(/(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|above|prior)\s+instructions/gi, "[нейтралізовано]");
  if (text.length > AI_CONTEXT_MAX_CHARS) text = `${text.slice(0, AI_CONTEXT_MAX_CHARS)}…`;
  return text;
}
