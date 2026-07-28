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

test("renders development preview metadata", async () => {
  const response = await renderHome();

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("home is a card landing that routes into booking and staff login", async () => {
  const response = await renderHome();
  const html = await response.text();
  assert.match(html, /Чернігівський військовий госпіталь/);
  assert.match(html, /href=["']\/booking\?category=military["']/);
  assert.match(html, /href=["']\/booking\?category=civilian["']/);
  assert.match(html, /href=["']\/staff\/login["']/);
  assert.doesNotMatch(html, /radiologyos-app\.adamenko-artem96\.chatgpt\.site/);
});

test("booking page renders the full service catalog", async () => {
  const response = await renderPath("/booking");
  const html = await response.text();
  const visibleHtml = html.replace(/<!--.*?-->/g, "");
  assert.match(visibleHtml, /Повний каталог:\s*38\s*послуг/);
});
