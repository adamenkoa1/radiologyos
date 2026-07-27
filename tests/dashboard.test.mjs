import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("dashboard API aggregates across pillars and never mutates schema", async () => {
  const route = await read("app/api/staff/dashboard/route.ts");
  assert.match(route, /requireStaff\(request, db\)/);
  assert.match(route, /awaiting.?protocol|protocol_status NOT IN/i);
  assert.match(route, /imaging_studies/);
  assert.match(route, /nszu_status = 'pending'/);
  assert.match(route, /needProtocol|needImaging|confirmQueue/);
  assert.doesNotMatch(route, /CREATE\s+TABLE/i);
  assert.doesNotMatch(route, /ALTER\s+TABLE/i);
  assert.doesNotMatch(route, /INSERT\s+INTO/i);
  assert.doesNotMatch(route, /UPDATE\s+bookings/i);
});

async function renderPath(path) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("dashboard page renders inside the staff workspace", async () => {
  const response = await renderPath("/staff/dashboard");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Пульт відділення/);
});
