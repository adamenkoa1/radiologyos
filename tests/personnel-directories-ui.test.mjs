// UI кадрових довідників: сторінка працівника живиться довідниками з API
// (з fallback на дефолти), є сторінка керування, і довідники додано в хаб.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");

test("personnel form fills datalists from the directories API with a fallback", async () => {
  const page = await read("app/staff/personnel/page.tsx");
  assert.match(page, /fetch\("\/api\/staff\/personnel\/directories"/);
  assert.match(page, /DEFAULT_POSITIONS/);
  assert.match(page, /DEFAULT_RANKS/);
  assert.match(page, /positionOptions = directories\.positions\.length \? directories\.positions : DEFAULT_POSITIONS/);
  assert.match(page, /rankOptions = directories\.ranks\.length \? directories\.ranks : DEFAULT_RANKS/);
  // datalists render from the resolved options, not the raw constants
  assert.match(page, /<datalist id="personnel-position-options">\{positionOptions\.map/);
  assert.match(page, /<datalist id="personnel-rank-options">\{rankOptions\.map/);
  // link to the management page
  assert.match(page, /href="\/staff\/directories\/personnel-refs"/);
});

test("the personnel-refs management page manages both dictionaries via the API", async () => {
  const page = await read("app/staff/directories/personnel-refs/page.tsx");
  assert.match(page, /\/api\/staff\/personnel\/directories/);
  assert.match(page, /"POST"/);
  assert.match(page, /"PATCH"/);
  assert.match(page, /kind:"position"/);
  assert.match(page, /kind:"rank"/);
  assert.match(page, /Приховати|Приховане/);
});

test("directories hub links to the personnel refs dictionary", async () => {
  const hub = await read("app/staff/directories/page.tsx");
  assert.match(hub, /href:"\/staff\/directories\/personnel-refs"/);
  assert.match(hub, /Посади і звання/);
});
