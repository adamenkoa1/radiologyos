import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

async function renderPath(path) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

const renderHome = () => renderPath("/");

// Legacy static files remain in ASSETS, but may not replace the unified home.
async function renderWithAssets(path, assetBodies) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-a`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    {
      ASSETS: {
        fetch: async (req) => {
          const href = typeof req === "string" ? req : req instanceof URL ? req.href : req.url;
          const p = new URL(href).pathname;
          return p in assetBodies
            ? new Response(assetBodies[p], { status: 200 })
            : new Response("Not found", { status: 404 });
        },
      },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("the worker keeps the unified homepage at / when a legacy landing is present", async () => {
  const marker = "<main>v22-landing</main>";
  const response = await renderWithAssets("/", { "/site/index.html": marker });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Дослідження, запис і результат/);
  assert.doesNotMatch(html, /v22-landing/);
});

test("renders development preview metadata", async () => {
  const response = await renderHome();

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("home combines patient categories, services, booking and staff login", async () => {
  const response = await renderHome();
  const html = await response.text();
  assert.match(html, /Чернігівський військовий госпіталь/);
  assert.match(html, /Військовослужбовцям/);
  assert.match(html, /Цивільним пацієнтам/);
  assert.match(html, /id=["']booking["']/);
  assert.match(html, /href=["']\/staff\/login["']/);
  assert.doesNotMatch(html, /radiologyos-app\.adamenko-artem96\.chatgpt\.site/);
});

test("legacy /booking and /cabinet redirect to the v22 static pages", async () => {
  const civ = await renderPath("/booking?category=civilian");
  assert.equal(civ.status, 302);
  assert.match(civ.headers.get("location") ?? "", /\/site\/price\.html$/);

  const mil = await renderPath("/booking?category=military");
  assert.equal(mil.status, 302);
  assert.match(mil.headers.get("location") ?? "", /\/site\/military\.html$/);

  const cab = await renderPath("/cabinet");
  assert.equal(cab.status, 302);
  assert.match(cab.headers.get("location") ?? "", /\/site\/cabinet\.html$/);
});
