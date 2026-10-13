import type { ComposedFinding } from "./findings-composer";

// Детерміноване порівняння з попереднім дослідженням (MASTER PROMPT 3, E3).
//
// Призначення: з двох структурованих наборів знахідок (попереднє vs поточне
// дослідження ОДНОГО пацієнта, тієї самої ділянки/модальності) скласти ЧЕРНЕТКУ
// динаміки — без AI, без мережі, без egress даних пацієнта.
//
// Клінічні вимоги (узгоджено з власником проєкту):
// 1. Порівнюємо лише той самий пацієнт + та сама ділянка/модальність (guard).
// 2. Розрізняємо «знахідка відсутня» (ділянку оцінено, її немає) і «знахідка
//    не описана» (ділянку не оцінювали) — це РІЗНІ стани; динаміку ствердного
//    характеру (поява/зникнення) формуємо лише коли ділянку реально оцінено.
// 3. Розміри порівнюємо з нормалізацією мм; НЕ робимо висновок про динаміку за
//    незначною різницею (поріг significantSizeDeltaMm + відсоток).
// 4. Динаміку формуємо лише з ПІДТВЕРДЖЕНИХ структурованих знахідок; діагнози/
//    висновки попереднього дослідження НЕ переносимо.
// 5. Джерело порівняння зберігається в результаті; чернетка — дорадча, лікар
//    переглядає й редагує (вставляється append, нічого не перезаписується).
// 6. Жодних змін підписаних протоколів, lifecycle чи прав доступу (чиста функція).

export type StudyFindings = {
  // Людська мітка джерела (напр. «КТ ОГК · 2026-08-01 · №КТ-2026-114»).
  label: string;
  regionKey: string;        // ключ шаблону (ділянка + модальність)
  date?: string;            // ISO-дата дослідження, якщо відома
  findings: ComposedFinding[];
  // Органи/структури, які в цьому дослідженні РЕАЛЬНО оцінено (описано), навіть
  // якщо норма. Дозволяє відрізнити «немає» від «не описано».
  assessedTargets: string[];
};

export type ComparisonDeltaKind = "new" | "resolved" | "size_increase" | "size_decrease" | "not_comparable";
export type ComparisonDelta = {
  kind: ComparisonDeltaKind;
  targetId: string;
  findingId: string;
  text: string;
  priorMm?: number;
  currentMm?: number;
};

export type ComparisonResult =
  | { ok: false; note: string }
  | { ok: true; source: string; deltas: ComparisonDelta[]; draft: string };

export type CompareOptions = {
  // Підтвердження, що це той самий пацієнт (відповідальність викликача, напр.
  // immutable patient_id). За замовчуванням true — guard нижче все одно вимагає
  // явно передати false, щоб заблокувати.
  samePatient?: boolean;
  // Поріг суттєвої зміни розміру: і абсолютний (мм), і відносний (частка).
  significantSizeDeltaMm?: number;
  significantSizeDeltaFraction?: number;
};

function key(f: { targetId: string; findingId: string; laterality: string }): string {
  return `${f.targetId}:${f.findingId}:${f.laterality}`;
}

export function compareStudies(prior: StudyFindings, current: StudyFindings, opts: CompareOptions = {}): ComparisonResult {
  // Вимога 1 + 6: guard-и перед будь-яким висновком.
  if (opts.samePatient === false) {
    return { ok: false, note: "Порівняння неможливе: дослідження різних пацієнтів." };
  }
  if (prior.regionKey !== current.regionKey) {
    return { ok: false, note: "Порівняння неможливе: різні ділянка/модальність дослідження." };
  }

  const absThreshold = typeof opts.significantSizeDeltaMm === "number" ? opts.significantSizeDeltaMm : 2;
  const fracThreshold = typeof opts.significantSizeDeltaFraction === "number" ? opts.significantSizeDeltaFraction : 0.2;

  const priorAssessed = new Set(prior.assessedTargets);
  const currentAssessed = new Set(current.assessedTargets);
  const priorMap = new Map(prior.findings.map((f) => [key(f), f]));
  const currentMap = new Map(current.findings.map((f) => [key(f), f]));

  const deltas: ComparisonDelta[] = [];

  // Нові знахідки: є в поточному, немає в попередньому.
  for (const [k, f] of currentMap) {
    if (priorMap.has(k)) continue;
    if (priorAssessed.has(f.targetId)) {
      // Попередньо ділянку оцінено й знахідки не було → підтверджена поява.
      deltas.push({ kind: "new", targetId: f.targetId, findingId: f.findingId, text: `визначається поява ${f.noun}` });
    } else {
      // Ділянку в попередньому не оцінювали → динаміку стверджувати НЕ можна.
      deltas.push({
        kind: "not_comparable", targetId: f.targetId, findingId: f.findingId,
        text: `${capitalize(f.noun)} — у попередньому дослідженні ця ділянка не описана, тож динаміку встановити не можна`,
      });
    }
  }

  // Зниклі знахідки: були в попередньому, немає в поточному.
  for (const [k, f] of priorMap) {
    if (currentMap.has(k)) continue;
    if (currentAssessed.has(f.targetId)) {
      deltas.push({ kind: "resolved", targetId: f.targetId, findingId: f.findingId, text: `не визначається раніше описаних змін — ${f.noun} (регрес)` });
    } else {
      deltas.push({
        kind: "not_comparable", targetId: f.targetId, findingId: f.findingId,
        text: `${capitalize(f.noun)} — у поточному дослідженні ця ділянка не описана, тож динаміку встановити не можна`,
      });
    }
  }

  // Зміна розміру: знахідка є в обох і має sizeMm в обох.
  for (const [k, cur] of currentMap) {
    const prev = priorMap.get(k);
    if (!prev) continue;
    const a = prev.measurements?.sizeMm;
    const b = cur.measurements?.sizeMm;
    if (typeof a !== "number" || typeof b !== "number") continue;
    const delta = b - a;
    const significant = Math.abs(delta) >= absThreshold && (a === 0 ? true : Math.abs(delta) / a >= fracThreshold);
    if (!significant) continue; // Вимога 3: незначну різницю не трактуємо як динаміку.
    deltas.push({
      kind: delta > 0 ? "size_increase" : "size_decrease",
      targetId: cur.targetId, findingId: cur.findingId, priorMm: a, currentMm: b,
      text: `${delta > 0 ? "збільшення" : "зменшення"} розмірів (${fmtMm(a)} → ${fmtMm(b)}) — ${cur.noun}`,
    });
  }

  const source = `${prior.label}${prior.date ? "" : ""}`;
  const confirmed = deltas.filter((d) => d.kind !== "not_comparable");
  let draft: string;
  if (confirmed.length === 0 && deltas.length === 0) {
    draft = `У порівнянні з попереднім дослідженням (${prior.label}) суттєвої динаміки структурованих знахідок не виявлено.`;
  } else if (confirmed.length === 1 && deltas.length === 1) {
    // Один чіткий зсув — одне речення (еталон §E3).
    draft = `У порівнянні з попереднім дослідженням ${confirmed[0].text}.`;
  } else {
    const lines = deltas.map((d) => `— ${d.text}.`);
    draft = [`У порівнянні з попереднім дослідженням (${prior.label}):`, ...lines].join("\n");
  }

  return { ok: true, source, deltas, draft };
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function fmtMm(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${Number.isInteger(r) ? r : String(r).replace(".", ",")} мм`;
}
