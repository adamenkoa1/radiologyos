// Клінічна валідація правил бібліотеки (MP4 Этап 5-6 / PR4). Доводить, що кожне
// з 8 правил warn_only РЕАЛЬНО спрацьовує наявною детермінованою перевіркою, і
// що 3 синтетичні приклади тримаються як очікування (НЕ як реальні записи).

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CLINICAL_RULE_IMPL, verifyRuleCoverage } from "../lib/clinical-library-rules.ts";
import { findContradictions } from "../lib/protocol-contradictions.ts";
import { compareStudies } from "../lib/protocol-comparison.ts";
import { renderLibraryFinding } from "../lib/clinical-library-finding.ts";

const readJson = async (n) => JSON.parse(await readFile(new URL(`../clinical-library/${n}`, import.meta.url), "utf8"));
const rules = await readJson("radiologyos-clinical-rules.json");
const examples = await readJson("radiologyos-template-examples.json");
const findings = await readJson("radiologyos-pathology-findings.json");
const findingById = (id) => findings.find((f) => f.id === id);
const codes = (input) => findContradictions(input).map((c) => c.code);

test("every one of the 8 library rules is mapped to a concrete implementation", () => {
  assert.equal(rules.length, 8);
  const cov = verifyRuleCoverage(rules);
  assert.equal(cov.complete, true, `uncovered: ${cov.uncovered.join(", ")}`);
  assert.equal(cov.covered.length, 8);
});

// 7 детермінованих правил суперечностей — кожне реально спрацьовує, і код збігається з мапою.
const CONTRADICTION_TRIPS = {
  side_conflict: { findings: "У правій легені вогнище.", conclusion: "Зміни у лівій легені." },
  gallbladder_conflict: { findings: "Жовчний міхур не збільшений, конкрементів немає.", conclusion: "КТ-ознаки дистензії жовчного міхура." },
  ascites_conflict: { findings: "У черевній порожнині визначається вільна рідина.", conclusion: "Вільної рідини не виявлено." },
  fracture_level_conflict: { findings: "Перелом остистого відростка C6.", conclusion: "Перелом на рівні C7." },
  disc_morphology_conflict: { findings: "Протрузія диска L4-L5 розміром 5 мм.", conclusion: "Грижа диска L4-L5." },
  native_ct_vascular_claim: { findings: "Нативне дослідження.", conclusion: "Ознаки тромбозу ворітної вени.", contrast: "Без контрастування" },
  unit_conversion_conflict: { findings: "Утворення розміром 18 мм.", conclusion: "Утворення 18 см." },
};

for (const [ruleId, input] of Object.entries(CONTRADICTION_TRIPS)) {
  test(`rule «${ruleId}» fires its mapped contradiction code`, () => {
    const impl = CLINICAL_RULE_IMPL[ruleId];
    assert.equal(impl.impl, "contradictions");
    assert.ok(codes(input).includes(impl.contradictionCode), `${ruleId} → ${impl.contradictionCode}`);
  });
}

test("rule «different_modality_visibility»: cross-modality comparison is blocked (no regression conclusion)", () => {
  // example_003: попередня МРТ, поточна КТ. regionKey кодує модальність+ділянку.
  const prior = { label: "МРТ головного мозку · 2026-05-01", regionKey: "mri_brain", findings: [], assessedTargets: ["brain"] };
  const current = { label: "КТ головного мозку · 2026-10-01", regionKey: "ct_brain", findings: [], assessedTargets: ["brain"] };
  const result = compareStudies(prior, current);
  assert.equal(result.ok, false);
  assert.match(result.note, /різні ділянка\/модальність/);
  assert.equal(CLINICAL_RULE_IMPL.different_modality_visibility.impl, "comparison");
});

test("synthetic examples are fixtures, not records: 3 present, each names a finding or a comparison", () => {
  assert.equal(examples.length, 3);
  const e1 = examples.find((e) => e.id === "example_001");
  const e2 = examples.find((e) => e.id === "example_002");
  const e3 = examples.find((e) => e.id === "example_003");
  assert.equal(e1.finding_id, "finding_018");
  assert.equal(e2.finding_id, "finding_026");
  assert.equal(e3.previous_modality, "MRI");
});

test("example_001 renders a draft naming the given level (C6)", () => {
  const r = renderLibraryFinding(findingById("finding_018"), { level: "C6", displacement_mm: 3 });
  assert.equal(r.ok, true);
  assert.match(`${r.description} ${r.conclusion}`, /C6/);
});

test("example_002: HU alone cannot prove purulence — finding stays image-confirmation-gated", () => {
  const f = findingById("finding_026");
  assert.equal(f.certainty, "requires_image_confirmation");
  const r = renderLibraryFinding(f, { side: "ліворуч", density_hu: 29 });
  assert.equal(r.ok, true);
  // Висновок не стверджує «гнійний» як доведений факт без підтвердження.
  assert.doesNotMatch(r.conclusion, /достовірно гнійн|підтверджен(о|ий) гнійн/i);
});
