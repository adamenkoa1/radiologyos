// Гігієна <head> індексованих статичних сторінок (ті, що в sitemap):
// робить технічні вимоги docs/seo.md виконуваними — lang, title, опис,
// canonical, Open Graph. Читає файли напряму (тест у Node, не на Worker).

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// Сторінки, що потрапляють у пошуковий індекс (app/sitemap.ts).
const INDEXABLE = ["index.html", "military.html", "price.html"];

async function head(file) {
  const html = await readFile(new URL(`../public/site/${file}`, import.meta.url), "utf8");
  return html.slice(0, html.indexOf("</head>") + 7);
}

for (const file of INDEXABLE) {
  test(`${file}: коректний <head> для пошуку`, async () => {
    const h = await head(file);
    assert.match(h, /<html[^>]*\blang="uk"/, "lang=uk");
    const title = h.match(/<title>([^<]*)<\/title>/);
    assert.ok(title && title[1].trim().length > 0, "непорожній <title>");
    assert.match(h, /name="description"[^>]*content="[^"]{40,}"/, "опис ≥40 символів");
    assert.match(h, /rel="canonical"/, "canonical");
    assert.match(h, /property="og:title"/, "og:title");
  });
}
