// Охоронець покриття sitemap / robots та ізоляції приватних поверхонь від
// індексації (docs/seo.md). Офлайн: імпортує чисті дані й robots, а sitemap.ts,
// next.config.ts і staff-layout звіряє як текст (sitemap.ts має
// extensionless-імпорт, тож напряму під node --test не вантажиться).

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import robots from "../app/robots.ts";
import { CT_SEO_PAGES, XRAY_SEO_PAGE, FLUORO_SEO_PAGE } from "../lib/seo-service-pages.ts";

const BASE = "https://radiologyos.tech";
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

const servicePaths = [
  ...Object.values(CT_SEO_PAGES).map((p) => p.path),
  XRAY_SEO_PAGE.path,
  FLUORO_SEO_PAGE.path,
];

test("шляхи сервісних сторінок нормалізовані й унікальні", () => {
  for (const p of servicePaths) {
    assert.ok(p.startsWith("/") && p.endsWith("/"), `${p}: має починатися і завершуватися «/»`);
  }
  assert.equal(new Set(servicePaths).size, servicePaths.length, "є дубльовані шляхи");
});

test("sitemap будується з усіх джерел сервісних сторінок + ключові статичні", async () => {
  const src = await read("app/sitemap.ts");
  // Усі сервісні сторінки покриваються за конструкцією (спреди джерел).
  assert.match(src, /\.\.\.Object\.values\(CT_SEO_PAGES\)/);
  assert.match(src, /\bXRAY_SEO_PAGE\b/);
  assert.match(src, /\bFLUORO_SEO_PAGE\b/);
  // Головна + прайс + військовим.
  assert.match(src, /\$\{BASE_URL\}\/`/); // home
  assert.match(src, /\/site\/price\.html/);
  assert.match(src, /\/site\/military\.html/);
});

test("sitemap не містить приватних/службових маршрутів", async () => {
  const src = await read("app/sitemap.ts");
  for (const forbidden of ["/staff", "/api/", "cabinet", "/patients", "/protocols"]) {
    assert.ok(!src.includes(forbidden), `sitemap не має посилатися на ${forbidden}`);
  }
});

test("robots.txt: забороняє /api/ і оголошує sitemap та host", () => {
  const r = robots();
  const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
  const disallow = [].concat(rule.disallow || []);
  assert.ok(disallow.includes("/api/"), "має забороняти /api/");
  assert.equal(r.sitemap, `${BASE}/sitemap.xml`);
  assert.equal(r.host, BASE);
});

test("приватні поверхні мають X-Robots-Tag noindex (next.config)", async () => {
  const cfg = await read("next.config.ts");
  // /staff/* — noindex.
  assert.match(cfg, /source:\s*["'`]\/staff\/:path\*["'`]/);
  // Кабінет пацієнта — noindex.
  assert.match(cfg, /source:\s*["'`]\/site\/cabinet\.html["'`]/);
  // Значення заголовка саме noindex.
  assert.match(cfg, /X-Robots-Tag[\s\S]{0,60}noindex/);
});

test("кабінет персоналу закрито від індексації в метаданих layout", async () => {
  const layout = await read("app/staff/layout.tsx");
  assert.match(layout, /robots\s*:/);
  assert.match(layout, /index\s*:\s*false/);
});

test("кабінет пацієнта не потрапляє в sitemap", async () => {
  const src = await read("app/sitemap.ts");
  assert.ok(!src.includes("cabinet"), "cabinet.html не має бути у sitemap");
});
