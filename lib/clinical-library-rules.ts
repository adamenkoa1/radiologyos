import type { ClinicalRule } from "./clinical-library";

// Звірка клінічних правил бібліотеки (MASTER PROMPT 4, Этап 5 / PR4 Clinical
// Validation) з уже реалізованими ДЕТЕРМІНОВАНИМИ перевірками проєкту. Чистий
// модуль-довідник: лише описує, ЯКА наявна реалізація покриває кожне правило
// бібліотеки. Жодної мережі/AI/БД/egress; нічого не публікується.
//
// Бібліотека постачає 8 правил warn_only зі статусом
// "specification_only_not_verified_against_PR661". Тут ми фіксуємо відповідність:
// 7 — детермінований контролер суперечностей (lib/protocol-contradictions.ts,
// MP3 E2), 1 — рушій порівняння (lib/protocol-comparison.ts, MP3 E3, guard
// крос-модальності). Тест PR4 доводить, що кожне правило реально спрацьовує.

export type RuleImplementation = {
  // Де реалізовано.
  impl: "contradictions" | "comparison";
  // Код контрадикції (для impl === "contradictions").
  contradictionCode?: string;
  // Короткий опис звʼязку.
  note: string;
};

export const CLINICAL_RULE_IMPL: Record<string, RuleImplementation> = {
  side_conflict: {
    impl: "contradictions",
    contradictionCode: "laterality_description_vs_conclusion",
    note: "Протилежна латералізація опис↔висновок.",
  },
  gallbladder_conflict: {
    impl: "contradictions",
    contradictionCode: "gallbladder_distension_without_finding",
    note: "Дистензія жовчного у висновку без підтвердження в описі.",
  },
  ascites_conflict: {
    impl: "contradictions",
    contradictionCode: "ascites_present_but_denied",
    note: "Асцит присутній в описі vs заперечений у висновку (і навпаки).",
  },
  fracture_level_conflict: {
    impl: "contradictions",
    contradictionCode: "fracture_level_mismatch",
    note: "Різний рівень перелому хребця опис↔висновок.",
  },
  disc_morphology_conflict: {
    impl: "contradictions",
    contradictionCode: "protrusion_called_herniation",
    note: "Протрузія в описі → грижа у висновку без підтвердження.",
  },
  native_ct_vascular_claim: {
    impl: "contradictions",
    contradictionCode: "occlusion_on_native_ct",
    note: "Судинна оклюзія/тромбоз у висновку на нативній КТ.",
  },
  unit_conversion_conflict: {
    impl: "contradictions",
    contradictionCode: "unit_mm_cm_mismatch",
    note: "Та сама величина в мм (опис) і см (висновок).",
  },
  different_modality_visibility: {
    impl: "comparison",
    note: "Невидимість на КТ знахідки попередньої МРТ ≠ регрес: guard крос-модальності блокує порівняння.",
  },
};

// Повертає, які правила покриті реалізацією, а які — ні.
export function verifyRuleCoverage(rules: ClinicalRule[]): {
  covered: string[];
  uncovered: string[];
  complete: boolean;
} {
  const covered: string[] = [];
  const uncovered: string[] = [];
  for (const r of rules) {
    if (CLINICAL_RULE_IMPL[r.id]) covered.push(r.id);
    else uncovered.push(r.id);
  }
  return { covered, uncovered, complete: uncovered.length === 0 };
}
