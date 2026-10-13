// Конструктор структурованих знахідок (lib/findings-composer.ts).
// Перевіряє детерміновану композицію граматичного українського тексту опису й
// висновку, append-семантику (ручні правки не перезаписуються) та клінічні
// перевірки §10. Еталонний приклад — з MASTER-завдання (КТ ОГК, S7–S10).

import assert from "node:assert/strict";
import test from "node:test";
import {
  composeFinding,
  insertComposedFinding,
  reviewProtocol,
  regionByKey,
  FINDINGS_CATALOG,
} from "../lib/findings-composer.ts";

const MINUS = "−";

// Мінімальний ProtocolDocument-літерал (не імпортуємо lib/protocols.ts у
// рантаймі — її внутрішній extensionless-імпорт "./catalog" резолвить лише
// бандлер, тож тут будуємо документ вручну). Збігається з формою ProtocolDocument.
function doc(overrides = {}) {
  return {
    templateKey: "generic",
    method: "",
    methodRef: "",
    sections: {},
    findings: "",
    conclusion: "",
    recommendations: "",
    number: "",
    status: "draft",
    ...overrides,
  };
}

test("§5 reference example composes the exact description and conclusion", () => {
  const result = composeFinding({
    regionKey: "ct_chest",
    targetId: "lung",
    findingId: "hyperpneumatization",
    laterality: "right",
    lobeId: "lower",
    segmentId: "basal",
    measurements: { hu: -952 },
    modifierIds: ["poor_vascular", "no_bullae"],
  });
  assert.equal(result.ok, true);
  assert.equal(
    result.finding.description,
    `У базальних сегментах S7–S10 нижньої частки правої легені визначається локальна ділянка вираженої гіперпневматизації легеневої паренхіми зі зниженням денситометричної щільності до ${MINUS}952 HU, збідненням легеневого судинного малюнка, без сформованих бул.`,
  );
  assert.equal(
    result.finding.conclusion,
    "КТ-ознаки локальної вираженої гіперпневматизації базальних сегментів S7–S10 нижньої частки правої легені.",
  );
});

test("negative HU renders with a true minus sign, not a hyphen", () => {
  const result = composeFinding({
    regionKey: "ct_chest", targetId: "lung", findingId: "hyperpneumatization",
    laterality: "left", lobeId: "upper", measurements: { hu: -940 },
  });
  assert.equal(result.ok, true);
  assert.match(result.finding.description, new RegExp(`${MINUS}940 HU`));
  assert.doesNotMatch(result.finding.description, /-940/); // ASCII hyphen must not appear
});

test("laterality and lobe decline correctly without a segment preset", () => {
  const result = composeFinding({
    regionKey: "ct_chest", targetId: "lung", findingId: "infiltration",
    laterality: "left", lobeId: "lower", measurements: { sizeMm: 24 },
  });
  assert.equal(result.ok, true);
  assert.equal(
    result.finding.description,
    "У нижній частці лівої легені визначається ділянка інфільтрації легеневої паренхіми розміром 24 мм.",
  );
  assert.equal(result.finding.conclusion, "КТ-ознаки вогнищево-інфільтративних змін нижньої частки лівої легені.");
});

test("whole-lung site is used when neither lobe nor segment is chosen", () => {
  const result = composeFinding({
    regionKey: "ct_chest", targetId: "lung", findingId: "nodule",
    laterality: "right", measurements: { sizeMm: 8, hu: 40 },
  });
  assert.equal(result.ok, true);
  assert.equal(
    result.finding.description,
    "У правій легені визначається солідний вузлик з чіткими контурами розміром 8 мм, щільністю 40 HU.",
  );
});

test("lung finding without a side is rejected (laterality required)", () => {
  const result = composeFinding({
    regionKey: "ct_chest", targetId: "lung", findingId: "hyperpneumatization",
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /сторону/);
});

test("non-lateralized organ composes a fixed-site sentence", () => {
  const result = composeFinding({
    regionKey: "ct_abdomen", targetId: "liver", findingId: "focal_lesion",
    measurements: { sizeMm: 18, hu: 42 },
  });
  assert.equal(result.ok, true);
  assert.equal(
    result.finding.description,
    "У печінці визначається вогнищеве утворення розміром 18 мм, щільністю 42 HU.",
  );
  assert.equal(result.finding.conclusion, "КТ-ознаки вогнищевого утворення печінки, що потребує уточнення.");
});

test("lateralized abdominal organ (kidney) declines by side", () => {
  const result = composeFinding({
    regionKey: "ct_abdomen", targetId: "kidney", findingId: "stone",
    laterality: "left", measurements: { sizeMm: 6, hu: 900 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.finding.description, "У лівій нирці визначається конкремент розміром 6 мм, щільністю 900 HU.");
  assert.equal(result.finding.conclusion, "КТ-ознаки конкремента лівої нирки.");
});

test("brain hemorrhage declines by hemisphere", () => {
  const result = composeFinding({
    regionKey: "ct_brain", targetId: "brain", findingId: "hemorrhage",
    laterality: "right", measurements: { sizeMm: 15, hu: 65 },
  });
  assert.equal(result.ok, true);
  assert.match(result.finding.description, /У правій півкулі головного мозку визначається ділянка підвищеної щільності/);
  assert.match(result.finding.description, /що відповідає крововиливу\.$/);
  assert.equal(result.finding.conclusion, "КТ-ознаки крововиливу правої півкулі головного мозку.");
});

test("mutually exclusive modifiers are rejected", () => {
  const result = composeFinding({
    regionKey: "ct_chest", targetId: "lung", findingId: "hyperpneumatization",
    laterality: "right", lobeId: "lower", modifierIds: ["no_bullae", "with_bullae"],
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /не можна поєднувати/);
});

test("insertComposedFinding appends and never overwrites manual edits", () => {
  const base = doc({ templateKey: "ct_chest", findings: "Ручний опис лікаря.", conclusion: "Ручний висновок." });
  const result = composeFinding({
    regionKey: "ct_chest", targetId: "lung", findingId: "infiltration",
    laterality: "right", lobeId: "lower", measurements: { sizeMm: 20 },
  });
  assert.equal(result.ok, true);
  const next = insertComposedFinding(base, result.finding);
  assert.match(next.findings, /^Ручний опис лікаря\./); // manual text preserved at top
  assert.match(next.findings, /ділянка інфільтрації/);  // composed text appended
  assert.match(next.conclusion, /^Ручний висновок\./);
  // Re-inserting the same finding does not duplicate it.
  const again = insertComposedFinding(next, result.finding);
  assert.equal(again.findings, next.findings);
  assert.equal(again.conclusion, next.conclusion);
});

test("insert leaves the document immutable (returns a new object)", () => {
  const base = doc({ templateKey: "ct_abdomen" });
  const result = composeFinding({ regionKey: "ct_abdomen", targetId: "free_fluid", findingId: "ascites", measurements: { volumeMl: 300 } });
  assert.equal(result.ok, true);
  const next = insertComposedFinding(base, result.finding);
  assert.notEqual(next, base);
  assert.equal(base.findings, ""); // original untouched
});

// ── Клінічні перевірки §10 ────────────────────────────────────────────────────
test("review flags norm left in a structured field after a pathology finding", () => {
  // lungs.parenchyma still carries the template's normal phrase.
  const base = doc({ templateKey: "ct_chest", sections: { lungs: { parenchyma: "Легеневі поля прозорі, без вогнищевих та інфільтративних змін." } } });
  const result = composeFinding({
    regionKey: "ct_chest", targetId: "lung", findingId: "infiltration",
    laterality: "right", lobeId: "lower", measurements: { sizeMm: 20 },
  });
  assert.equal(result.ok, true);
  const warnings = reviewProtocol({ document: base, findings: [result.finding] });
  assert.ok(warnings.some((w) => w.code === "norm_with_pathology"));
});

test("review flags a left+right split of the same finding as a laterality conflict", () => {
  const base = doc({ templateKey: "ct_chest" });
  const right = composeFinding({ regionKey: "ct_chest", targetId: "lung", findingId: "nodule", laterality: "right", measurements: { sizeMm: 6 } });
  const left = composeFinding({ regionKey: "ct_chest", targetId: "lung", findingId: "nodule", laterality: "left", measurements: { sizeMm: 7 } });
  assert.equal(right.ok && left.ok, true);
  const warnings = reviewProtocol({ document: base, findings: [right.finding, left.finding] });
  assert.ok(warnings.some((w) => w.code === "laterality_conflict"));
});

test("review flags dynamics mentioned without a prior study", () => {
  const base = doc({ templateKey: "ct_brain", conclusion: "Без динаміки порівняно з попереднім дослідженням." });
  const warnings = reviewProtocol({ document: base, findings: [], hasPriorStudy: false });
  assert.ok(warnings.some((w) => w.code === "dynamics_without_prior"));
  // With a prior study, the same text is fine.
  const ok = reviewProtocol({ document: base, findings: [], hasPriorStudy: true });
  assert.ok(!ok.some((w) => w.code === "dynamics_without_prior"));
});

test("review flags characterization that needs contrast on a non-contrast study", () => {
  const base = doc({ templateKey: "ct_abdomen", sections: { parameters: { contrast: "Без контрастування" } } });
  const result = composeFinding({ regionKey: "ct_abdomen", targetId: "liver", findingId: "focal_lesion", measurements: { sizeMm: 18 } });
  assert.equal(result.ok, true);
  const warnings = reviewProtocol({ document: base, findings: [result.finding] });
  assert.ok(warnings.some((w) => w.code === "contrast_missing_for_characterization"));
});

test("catalog is self-consistent: every region key maps to a protocol template key", () => {
  for (const region of FINDINGS_CATALOG) {
    assert.ok(regionByKey(region.key), `region ${region.key} resolvable`);
    assert.ok(region.targets.length > 0, `region ${region.key} has targets`);
    for (const target of region.targets) {
      assert.ok(target.findings.length > 0, `target ${target.id} has findings`);
    }
  }
});

// ── D1: розширений каталог ────────────────────────────────────────────────────
test("catalog covers the five expected regions with correct conclusion prefixes", () => {
  const prefixes = Object.fromEntries(FINDINGS_CATALOG.map((r) => [r.key, r.conclusionPrefix]));
  assert.equal(prefixes.ct_chest, "КТ-ознаки");
  assert.equal(prefixes.ct_brain, "КТ-ознаки");
  assert.equal(prefixes.ct_abdomen, "КТ-ознаки");
  assert.equal(prefixes.ct_sinuses, "КТ-ознаки");
  assert.equal(prefixes.ct_spine, "КТ-ознаки");
  assert.equal(prefixes.xray_chest, "Рентгенологічні ознаки");
  assert.equal(prefixes.fluoro_chest, "Флюорографічні ознаки");
});

test("xray chest uses the radiographic conclusion prefix, not the CT one", () => {
  const result = composeFinding({ regionKey: "xray_chest", targetId: "lung", findingId: "infiltration", laterality: "right" });
  assert.equal(result.ok, true);
  assert.equal(result.finding.description, "У правій легені визначається інфільтративне затемнення легеневої тканини.");
  assert.equal(result.finding.conclusion, "Рентгенологічні ознаки інфільтративних змін правої легені.");
});

test("fluorography focal shadow recommends follow-up and uses the fluoro prefix", () => {
  const result = composeFinding({ regionKey: "fluoro_chest", targetId: "lung", findingId: "focal_shadow", laterality: "left", measurements: { sizeMm: 9 } });
  assert.equal(result.ok, true);
  assert.equal(result.finding.description, "У лівій легені визначається вогнищева тінь розміром 9 мм.");
  assert.match(result.finding.conclusion, /^Флюорографічні ознаки вогнищевих змін лівої легені/);
  assert.match(result.finding.conclusion, /КТ ОГК/);
});

test("ct sinuses maxillary sinus declines by side", () => {
  const result = composeFinding({ regionKey: "ct_sinuses", targetId: "maxillary_sinus", findingId: "mucosal_thickening", laterality: "right", measurements: { sizeMm: 7 } });
  assert.equal(result.ok, true);
  assert.equal(result.finding.description, "У правій верхньощелепній пазусі визначається потовщення слизової оболонки розміром 7 мм.");
  assert.equal(result.finding.conclusion, "КТ-ознаки потовщення слизової правої верхньощелепної пазухи.");
});

test("ct spine disc protrusion composes with genitive site", () => {
  const result = composeFinding({ regionKey: "ct_spine", targetId: "disc", findingId: "protrusion", measurements: { sizeMm: 4 } });
  assert.equal(result.ok, true);
  assert.equal(result.finding.description, "Визначається протрузія міжхребцевого диска розміром 4 мм.");
  assert.equal(result.finding.conclusion, "КТ-ознаки протрузії міжхребцевого диска.");
});

test("ct abdomen gained spleen, gallbladder and pancreas targets", () => {
  const region = regionByKey("ct_abdomen");
  const ids = region.targets.map((t) => t.id);
  for (const id of ["liver", "kidney", "free_fluid", "spleen", "gallbladder", "pancreas"]) assert.ok(ids.includes(id), `abdomen has ${id}`);
});

test("every catalog finding composes a full sentence with a minimal selection", () => {
  for (const region of FINDINGS_CATALOG) for (const target of region.targets) for (const finding of target.findings) {
    const result = composeFinding({
      regionKey: region.key, targetId: target.id, findingId: finding.id,
      laterality: target.laterality ? "right" : undefined,
    });
    assert.equal(result.ok, true, `${region.key}/${target.id}/${finding.id} composes`);
    assert.ok(result.finding.description.endsWith("."), "description is a full sentence");
    assert.ok(result.finding.conclusion.length > 0, "conclusion non-empty");
  }
});

test("clinical hints are present on key measurement-bearing findings", () => {
  const region = regionByKey("ct_chest");
  const lung = region.targets.find((t) => t.id === "lung");
  const nodule = lung.findings.find((f) => f.id === "nodule");
  assert.ok(typeof nodule.hint === "string" && nodule.hint.length > 0);
});
