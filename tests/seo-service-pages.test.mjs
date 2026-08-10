import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const expectedPaths = [
  "/ct/",
  "/ct/head/",
  "/ct/chest/",
  "/ct/abdomen/",
  "/ct/spine/",
  "/ct/joints/",
  "/ct/contrast/",
  "/xray/",
  "/fluorography/",
];

test("SEO landing definitions cover every planned service URL", async () => {
  const definitions = await read("lib/seo-service-pages.ts");
  for (const path of expectedPaths) assert.match(definitions, new RegExp(path.replaceAll("/", "\\/")));
  assert.match(definitions, /КТ головного мозку у Чернігові/);
  assert.match(definitions, /КТ органів грудної клітки у Чернігові/);
  assert.match(definitions, /Цифровий рентген у Чернігові/);
  assert.match(definitions, /Флюорографія у Чернігові/);
});

test("landing pages do not duplicate tariff values and use the effective public service API", async () => {
  const component = await read("app/components/seo-service-landing.tsx");
  assert.match(component, /fetch\("\/api\/public-services"/);
  assert.match(component, /service\.price/);
  assert.match(component, /availableToCivilian/);
  assert.doesNotMatch(component, /price:\s*\d+/);
  assert.doesNotMatch(component, /tel:\+380000000000/);
});

test("every SEO landing has a direct booking CTA and canonical metadata", async () => {
  const component = await read("app/components/seo-service-landing.tsx");
  const ct = await read("app/ct/[[...slug]]/page.tsx");
  const xray = await read("app/xray/page.tsx");
  const fluoro = await read("app/fluorography/page.tsx");
  assert.match(component, /\/site\/price\.html/);
  assert.match(component, /Записатися на дослідження/);
  for (const route of [ct, xray, fluoro]) assert.match(route, /alternates:\s*\{ canonical:/);
});

test("sitemap includes the public service landing collection", async () => {
  const sitemap = await read("app/sitemap.ts");
  assert.match(sitemap, /CT_SEO_PAGES/);
  assert.match(sitemap, /XRAY_SEO_PAGE/);
  assert.match(sitemap, /FLUORO_SEO_PAGE/);
  assert.match(sitemap, /servicePages/);
});
