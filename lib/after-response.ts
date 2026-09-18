// Виконати best-effort побічний ефект ПІСЛЯ відповіді, не блокуючи її.
//
// На Cloudflare Workers відповідь не має чекати на розсилку сповіщень: заявку
// вже збережено, а мережеві виклики (Telegram/e-mail) лише додають затримку —
// і на повільному шлюзі кнопка «Надсилаємо…» висить кілька секунд. waitUntil
// дає промісу дожити після повернення відповіді, не тримаючи клієнта.
//
// Контекст виконання кладеться в globalThis у worker/index.ts (як і DB). Поза
// Worker (тести/локально) контексту немає — тоді проміс просто відпускаємо
// (best-effort), обов'язково поглинувши помилку, щоб не було unhandled-rejection.

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export function runAfterResponse(promise: Promise<unknown>): void {
  const guarded = Promise.resolve(promise).catch(() => {});
  const ctx = (globalThis as typeof globalThis & { __RADIOLOGY_CTX__?: ExecutionContextLike })
    .__RADIOLOGY_CTX__;
  if (ctx && typeof ctx.waitUntil === "function") {
    try {
      ctx.waitUntil(guarded);
      return;
    } catch {
      // Контекст уже завершено — впадемо у best-effort нижче.
    }
  }
  void guarded;
}
