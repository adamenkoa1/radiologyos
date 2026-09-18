import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { REGISTER_REPORT_UI_SECTIONS,resolveRegisterReportPeriod } from "../lib/register-report-view-ui.ts";

const PAGE_URL=new URL("../app/staff/reports/registers/page.tsx",import.meta.url);

test("register report period presets resolve deterministically",()=>{
  assert.deepEqual(resolveRegisterReportPeriod("current_month","2026-08-19","2020-01-01","2020-01-02"),{from:"2026-08-01",to:"2026-08-19"});
  assert.deepEqual(resolveRegisterReportPeriod("last_30_days","2026-08-19","2020-01-01","2020-01-02"),{from:"2026-07-21",to:"2026-08-19"});
  assert.deepEqual(resolveRegisterReportPeriod("custom","2026-08-19","2026-06-01","2026-06-30"),{from:"2026-06-01",to:"2026-06-30"});
});

test("register report UI section keys stay on the server allowlist contract",()=>{
  assert.deepEqual(REGISTER_REPORT_UI_SECTIONS.map(item=>item.key),[
    "summary","revenue","cash","expenses","equipment","staff","inventory","inventory_by_warehouse",
  ]);
});

test("register report page uses saved-view API and canonical server CSV export",async()=>{
  const source=await readFile(PAGE_URL,"utf8");
  assert.match(source,/fetch\("\/api\/staff\/reports\/views",\{cache:"no-store"\}\)/);
  assert.match(source,/fetch\("\/api\/staff\/reports\/views",\{method:"POST"/);
  assert.match(source,/method:"DELETE"/);
  assert.match(source,/\/api\/staff\/reports\/registers\/export\?/);
  assert.match(source,/sections:sections\.join\(","\)/);
  assert.match(source,/viewsAvailable===true/);
  assert.match(source,/sectionEnabled\("inventory_by_warehouse"\)/);
});
