import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the domain root is the single canonical homepage", async () => {
  const worker = await read("worker/index.ts");
  const home = await read("public/site/index.html");

  assert.match(worker, /LEGACY_HOME_PATHS = new Set\(\["\/index\.html", "\/site", "\/site\/", "\/site\/index\.html"\]\)/);
  assert.match(worker, /LEGACY_HOME_PATHS\.has\(url\.pathname\)/);
  assert.match(worker, /Response\.redirect\(canonicalHome\.toString\(\), 308\)/);
  assert.match(worker, /canonicalHome\.search = url\.search/);
  assert.match(worker, /if \(url\.pathname === "\/"\)/);
  assert.match(home, /<link rel="canonical" href="https:\/\/radiologyos\.tech\/"\/>/);
  assert.match(home, /<meta property="og:url" content="https:\/\/radiologyos\.tech\/"\/>/);
});

test("sitemap contains the canonical home only once", async () => {
  const sitemap = await read("app/sitemap.ts");
  assert.match(sitemap, /url: `\$\{BASE_URL\}\/`/);
  assert.doesNotMatch(sitemap, /BASE_URL\}\/site\/`/);
  assert.doesNotMatch(sitemap, /BASE_URL\}\/index\.html/);
  assert.doesNotMatch(sitemap, /BASE_URL\}\/site\/index\.html/);
  assert.match(sitemap, /BASE_URL\}\/site\/price\.html/);
  assert.match(sitemap, /BASE_URL\}\/site\/military\.html/);
});

test("indexable static landing pages have canonical response metadata and cabinet is noindex", async () => {
  const worker = await read("worker/index.ts");
  assert.match(worker, /PUBLIC_CANONICAL_PATHS = new Set\(\["\/", "\/site\/price\.html", "\/site\/military\.html"\]\)/);
  assert.match(worker, /headers\.set\("link", `<\$\{new URL\(pathname, url\.origin\)\.toString\(\)\}>; rel="canonical"`\)/);
  assert.match(worker, /pathname === "\/site\/cabinet\.html" \|\| pathname === "\/cabinet"/);
  assert.match(worker, /headers\.set\("x-robots-tag", "noindex, nofollow"\)/);
});
