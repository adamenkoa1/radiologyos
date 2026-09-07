// SEO-аудит — чиста логіка правил, дублікатів і health-score.

import assert from "node:assert/strict";
import test from "node:test";
import {
  auditSeoPages, summarizeSeo, SEO_LIMITS, SEO_RULES, BRAND,
} from "../lib/seo-audit.ts";

const good = {
  path: "/ct/",
  title: "КТ у Чернігові — ціни та онлайн-запис | RadiologyOS",
  description:
    "Комп'ютерна томографія у Чернігові: головний мозок, грудна клітка, черевна порожнина та КТ з контрастуванням. Актуальні ціни й онлайн-запис.",
  bodyText: "Комп'ютерна томографія дає пошарове зображення органів і тканин. ".repeat(6),
};

test("чиста коректна сторінка не дає жодної проблеми", () => {
  const issues = auditSeoPages([good]);
  assert.deepEqual(issues, []);
});

test("порожній title/description → помилки", () => {
  const issues = auditSeoPages([{ path: "/x", title: "", description: "" }]);
  const rules = issues.map((i) => i.rule);
  assert.ok(rules.includes("title-missing"));
  assert.ok(rules.includes("desc-missing"));
  assert.equal(SEO_RULES["title-missing"].severity, "error");
});

test("дублікати title та description позначаються на всіх сторінках-учасниках", () => {
  const issues = auditSeoPages([
    { path: "/a", title: `Однаковий заголовок у Чернігові | ${BRAND}`, description: "Опис досить довгий, щоб пройти поріг мінімальної довжини для Чернігова та інших сторінок." },
    { path: "/b", title: `Однаковий заголовок у Чернігові | ${BRAND}`, description: "Інший унікальний опис достатньої довжини про послуги у Чернігові для перевірки дублів." },
  ]);
  const dupTitle = issues.filter((i) => i.rule === "title-duplicate").map((i) => i.path).sort();
  assert.deepEqual(dupTitle, ["/a", "/b"]);
});

test("занадто довгий title і закороткий опис → попередження про довжину", () => {
  const longTitle = "К".repeat(SEO_LIMITS.titleMax + 5) + ` ${BRAND}`;
  const issues = auditSeoPages([
    { path: "/ct/head/", title: longTitle, description: "Короткий опис Чернігів." },
  ]);
  assert.ok(issues.some((i) => i.rule === "title-length"));
  assert.ok(issues.some((i) => i.rule === "desc-length"));
});

test("немає локального ключа → попередження", () => {
  const issues = auditSeoPages([
    { path: "/p", title: `Комп'ютерна томографія — ціни та запис | ${BRAND}`, description: "Загальний опис послуги достатньої довжини без згадки міста, лише про томографію та ціни." },
  ]);
  assert.ok(issues.some((i) => i.rule === "local-keyword"));
});

test("немає бренду в title → info", () => {
  const issues = auditSeoPages([
    { path: "/p", title: "КТ у Чернігові — ціна і запис сьогодні", description: "Опис послуги КТ у Чернігові достатньої довжини для проходження порогу мінімальної довжини." },
  ]);
  const brand = issues.find((i) => i.rule === "title-brand");
  assert.ok(brand);
  assert.equal(brand.severity, "info");
});

test("тонкий контент позначається лише коли bodyText задано", () => {
  const withThin = auditSeoPages([{ ...good, bodyText: "замало" }]);
  assert.ok(withThin.some((i) => i.rule === "thin-content"));
  const withoutBody = auditSeoPages([{ path: good.path, title: good.title, description: good.description }]);
  assert.ok(!withoutBody.some((i) => i.rule === "thin-content"));
});

test("summarizeSeo: score, лічильники за важливістю та чисті сторінки", () => {
  const pages = [
    good,
    { path: "/bad", title: "", description: "" },
  ];
  const issues = auditSeoPages(pages);
  const s = summarizeSeo(issues, pages.length);
  assert.equal(s.pages, 2);
  assert.equal(s.cleanPages, 1); // /ct/ чистий, /bad — ні
  assert.ok(s.errors >= 2);
  assert.ok(s.score >= 0 && s.score <= 100);
  assert.ok(s.score < 100); // є помилки → бал знижений
  // byRule відсортовано: error перед warn/info
  if (s.byRule.length > 1) {
    assert.ok(s.byRule[0].severity === "error" || s.byRule.every((r) => r.severity === s.byRule[0].severity));
  }
});

test("ідеальний набір → score 100", () => {
  const s = summarizeSeo(auditSeoPages([good]), 1);
  assert.equal(s.score, 100);
});
