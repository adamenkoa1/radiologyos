// Структуровані дані медичних сторінок — генератори, «хлібні крихти», валідатор,
// і перевірка, що КОЖНА реальна сервісна сторінка дає валідний граф.

import assert from "node:assert/strict";
import test from "node:test";
import {
  breadcrumbList, medicalWebPage, medicalProcedure, medicalPageGraph,
  validateJsonLd, safeJsonLd,
} from "../lib/structured-data.ts";
import { CT_SEO_PAGES, XRAY_SEO_PAGE, FLUORO_SEO_PAGE } from "../lib/seo-service-pages.ts";

const profile = {
  name: "Відділення променевої діагностики",
  department: "Чернігівський військовий госпіталь",
  url: "https://radiologyos.tech",
  telephone: "+380972808899",
  address: "вул. Гетьмана Полуботка, 40, Чернігів",
};
const DATE = "2026-09-08";

test("breadcrumbList: Головна → секція → сторінка з коректними позиціями й абсолютними URL", () => {
  const page = CT_SEO_PAGES.head;
  const bc = breadcrumbList(page, profile);
  assert.equal(bc["@type"], "BreadcrumbList");
  const items = bc.itemListElement;
  assert.deepEqual(items.map((i) => i.position), [1, 2, 3]);
  assert.equal(items[0].name, "Головна");
  assert.equal(items[1].name, "КТ");
  assert.equal(items[1].item, "https://radiologyos.tech/ct/");
  assert.equal(items[2].name, page.title);
  assert.equal(items[2].item, "https://radiologyos.tech/ct/head/");
});

test("breadcrumbList для одиночної сторінки (xray): Головна → сторінка", () => {
  const bc = breadcrumbList(XRAY_SEO_PAGE, profile);
  assert.deepEqual(bc.itemListElement.map((i) => i.position), [1, 2]);
  assert.equal(bc.itemListElement[1].item, "https://radiologyos.tech/xray/");
});

test("medicalWebPage має обов'язкові медичні поля й прив'язку до клініки", () => {
  const wp = medicalWebPage(CT_SEO_PAGES.chest, profile, DATE);
  assert.equal(wp["@type"], "MedicalWebPage");
  assert.equal(wp.inLanguage, "uk");
  assert.equal(wp.lastReviewed, DATE);
  assert.equal(wp.url, "https://radiologyos.tech/ct/chest/");
  assert.equal(wp.isPartOf["@id"], "https://radiologyos.tech/#clinic");
  assert.ok(wp.about && wp.about.name);
});

test("medicalProcedure включає підготовку, коли вона задана", () => {
  const proc = medicalProcedure(CT_SEO_PAGES.head, profile);
  assert.equal(proc["@type"], "MedicalProcedure");
  assert.ok(typeof proc.preparation === "string" && proc.preparation.length > 0);
});

test("validateJsonLd ловить відсутні обов'язкові поля", () => {
  const broken = { "@context": "https://schema.org", "@type": "MedicalWebPage", url: "x" };
  const issues = validateJsonLd(broken);
  const fields = issues.map((i) => i.field);
  assert.ok(fields.includes("name"));
  assert.ok(fields.includes("about"));

  const noCtx = { "@type": "MedicalProcedure", name: "КТ" };
  assert.ok(validateJsonLd(noCtx).some((i) => i.field === "@context"));
});

test("кожна реальна сервісна сторінка дає валідний граф", () => {
  const pages = [...Object.values(CT_SEO_PAGES), XRAY_SEO_PAGE, FLUORO_SEO_PAGE];
  for (const page of pages) {
    const graph = medicalPageGraph(page, profile, DATE);
    const issues = validateJsonLd(graph);
    assert.deepEqual(issues, [], `${page.path}: ${JSON.stringify(issues)}`);
    // Граф із трьох вузлів.
    assert.equal(graph["@graph"].length, 3);
  }
});

test("safeJsonLd екранує '<', щоб не закрити <script>", () => {
  const s = safeJsonLd({ x: "</script><b>" });
  assert.ok(!s.includes("</script>"));
  assert.ok(s.includes("\\u003c"));
});
