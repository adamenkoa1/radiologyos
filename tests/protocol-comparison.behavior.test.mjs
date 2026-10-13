// Детерміноване порівняння з попереднім дослідженням (MP3 E3).
// lib/protocol-comparison.ts + composeFinding (обидва — чисті, runtime-import
// безпечний). Перевіряємо 6 вимог власника: той самий пацієнт+ділянка;
// «відсутня» vs «не описана»; поріг розміру; лише підтверджені знахідки;
// джерело; еталонний приклад §E3.

import assert from "node:assert/strict";
import test from "node:test";
import { compareStudies } from "../lib/protocol-comparison.ts";
import { composeFinding } from "../lib/findings-composer.ts";

function mk(sel) {
  const r = composeFinding(sel);
  assert.equal(r.ok, true, `compose ${JSON.stringify(sel)}`);
  return r.finding;
}

test("§E3 reference: ascites appears vs a prior study that assessed the abdomen", () => {
  const ascites = mk({ regionKey: "ct_abdomen", targetId: "free_fluid", findingId: "ascites" });
  const prior = { label: "КТ ОЧП · 2026-07-01", regionKey: "ct_abdomen", findings: [], assessedTargets: ["free_fluid", "liver"] };
  const current = { label: "КТ ОЧП · 2026-09-01", regionKey: "ct_abdomen", findings: [ascites], assessedTargets: ["free_fluid", "liver"] };
  const res = compareStudies(prior, current);
  assert.equal(res.ok, true);
  assert.equal(res.draft, "У порівнянні з попереднім дослідженням визначається поява вільної рідини в черевній порожнині.");
  assert.equal(res.deltas.filter((d) => d.kind === "new").length, 1);
});

test("req #2: 'absent' (region assessed) differs from 'not described' (region not assessed)", () => {
  const ascites = mk({ regionKey: "ct_abdomen", targetId: "free_fluid", findingId: "ascites" });
  // Поточне асцит є; попереднє НЕ оцінювало ділянку вільної рідини → не «поява».
  const notAssessed = compareStudies(
    { label: "p", regionKey: "ct_abdomen", findings: [], assessedTargets: ["liver"] },
    { label: "c", regionKey: "ct_abdomen", findings: [ascites], assessedTargets: ["free_fluid", "liver"] },
  );
  assert.equal(notAssessed.ok, true);
  assert.equal(notAssessed.deltas.some((d) => d.kind === "new"), false);
  assert.ok(notAssessed.deltas.some((d) => d.kind === "not_comparable"));
  assert.match(notAssessed.draft, /не описана, тож динаміку встановити не можна/);
});

test("req #2: resolved only when the region is re-assessed in the current study", () => {
  const ascites = mk({ regionKey: "ct_abdomen", targetId: "free_fluid", findingId: "ascites" });
  // Було в попередньому; у поточному ділянку оцінено й знахідки немає → регрес.
  const resolved = compareStudies(
    { label: "p", regionKey: "ct_abdomen", findings: [ascites], assessedTargets: ["free_fluid"] },
    { label: "c", regionKey: "ct_abdomen", findings: [], assessedTargets: ["free_fluid"] },
  );
  assert.ok(resolved.deltas.some((d) => d.kind === "resolved"));
  // Якщо ділянку в поточному НЕ оцінено — не «зникнення», а not_comparable.
  const notRe = compareStudies(
    { label: "p", regionKey: "ct_abdomen", findings: [ascites], assessedTargets: ["free_fluid"] },
    { label: "c", regionKey: "ct_abdomen", findings: [], assessedTargets: ["liver"] },
  );
  assert.equal(notRe.deltas.some((d) => d.kind === "resolved"), false);
  assert.ok(notRe.deltas.some((d) => d.kind === "not_comparable"));
});

test("req #3: minor size difference is NOT reported; a significant one is", () => {
  const prior5 = mk({ regionKey: "ct_abdomen", targetId: "kidney", findingId: "stone", laterality: "left", measurements: { sizeMm: 5 } });
  const cur6 = mk({ regionKey: "ct_abdomen", targetId: "kidney", findingId: "stone", laterality: "left", measurements: { sizeMm: 6 } });
  const minor = compareStudies(
    { label: "p", regionKey: "ct_abdomen", findings: [prior5], assessedTargets: ["kidney"] },
    { label: "c", regionKey: "ct_abdomen", findings: [cur6], assessedTargets: ["kidney"] },
  );
  assert.equal(minor.deltas.some((d) => d.kind.startsWith("size")), false, "5→6 мм — не суттєво");

  const cur9 = mk({ regionKey: "ct_abdomen", targetId: "kidney", findingId: "stone", laterality: "left", measurements: { sizeMm: 9 } });
  const major = compareStudies(
    { label: "p", regionKey: "ct_abdomen", findings: [prior5], assessedTargets: ["kidney"] },
    { label: "c", regionKey: "ct_abdomen", findings: [cur9], assessedTargets: ["kidney"] },
  );
  const size = major.deltas.find((d) => d.kind === "size_increase");
  assert.ok(size, "5→9 мм — суттєво");
  assert.equal(size.priorMm, 5);
  assert.equal(size.currentMm, 9);
});

test("req #1: different region/modality or different patient blocks comparison", () => {
  const f = mk({ regionKey: "ct_abdomen", targetId: "free_fluid", findingId: "ascites" });
  const diffRegion = compareStudies(
    { label: "p", regionKey: "ct_chest", findings: [], assessedTargets: [] },
    { label: "c", regionKey: "ct_abdomen", findings: [f], assessedTargets: ["free_fluid"] },
  );
  assert.equal(diffRegion.ok, false);
  assert.match(diffRegion.note, /різні ділянка\/модальність/);

  const diffPatient = compareStudies(
    { label: "p", regionKey: "ct_abdomen", findings: [], assessedTargets: ["free_fluid"] },
    { label: "c", regionKey: "ct_abdomen", findings: [f], assessedTargets: ["free_fluid"] },
    { samePatient: false },
  );
  assert.equal(diffPatient.ok, false);
  assert.match(diffPatient.note, /різних пацієнтів/);
});

test("no change → explicit 'no significant dynamics' draft; source retained (req #5)", () => {
  const f = mk({ regionKey: "ct_abdomen", targetId: "free_fluid", findingId: "ascites" });
  const res = compareStudies(
    { label: "КТ ОЧП · 2026-07-01", regionKey: "ct_abdomen", findings: [f], assessedTargets: ["free_fluid"] },
    { label: "c", regionKey: "ct_abdomen", findings: [f], assessedTargets: ["free_fluid"] },
  );
  assert.equal(res.ok, true);
  assert.match(res.draft, /суттєвої динаміки структурованих знахідок не виявлено/);
  assert.equal(res.source, "КТ ОЧП · 2026-07-01");
});
