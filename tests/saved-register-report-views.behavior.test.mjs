import assert from "node:assert/strict";
import test from "node:test";
import { freshDb } from "./helpers/d1.mjs";
import { buildRegisterTurnoverCsv,normalizeRegisterReportSections } from "../lib/register-turnover-csv.ts";
import { createSavedRegisterReportView,deleteSavedRegisterReportView,getSavedRegisterReportView,listSavedRegisterReportViews,normalizeSavedRegisterReportConfig,updateSavedRegisterReportView } from "../lib/saved-report-views.ts";

const config={periodPreset:"custom",from:"2026-08-01",to:"2026-08-18",sections:["summary","inventory"]};

test("saved register report views are normalized and tenant scoped",async()=>{
  const {db,close}=await freshDb();try{
    const created=await createSavedRegisterReportView(db,{organizationId:1,actorEmail:"admin@one.test",name:" Серпень ",configuration:config});
    assert.equal(created.name,"Серпень");assert.deepEqual(created.configuration,config);
    assert.equal((await listSavedRegisterReportViews(db,1)).length,1);assert.equal((await listSavedRegisterReportViews(db,2)).length,0);
    assert.equal(await getSavedRegisterReportView(db,2,created.id),null);
    assert.equal(await updateSavedRegisterReportView(db,{organizationId:2,id:created.id,actorEmail:"admin@two.test",name:"Forged",configuration:config}),null);
    assert.equal(await deleteSavedRegisterReportView(db,2,created.id),null);
    assert.equal((await getSavedRegisterReportView(db,1,created.id)).name,"Серпень");
    await assert.rejects(()=>createSavedRegisterReportView(db,{organizationId:1,actorEmail:"admin@one.test",name:"Серпень",configuration:config}),/unique/i);
  }finally{close();}
});

test("saved report configuration rejects unsafe shapes and bounds custom periods",()=>{
  assert.deepEqual(normalizeSavedRegisterReportConfig({periodPreset:"current_month",sections:["summary","summary","bad"]}),{periodPreset:"current_month",from:"",to:"",sections:["summary"]});
  assert.throws(()=>normalizeSavedRegisterReportConfig({periodPreset:"custom",from:"2025-01-01",to:"2026-08-18",sections:["summary"]}),/report_period_too_large/);
  assert.throws(()=>normalizeSavedRegisterReportConfig({periodPreset:"custom",from:"2026-08-01",to:"2026-08-18",sections:[]}),/sections_invalid/);
  assert.deepEqual(normalizeRegisterReportSections("summary,inventory,summary,unknown"),["summary","inventory"]);
});

test("register CSV is BOM-prefixed, quoted, section-limited and formula-injection safe",()=>{
  const report={period:{from:"2026-08-01",to:"2026-08-18"},generatedAt:"2026-08-18T10:00:00.000Z",registers:{revenue:{increase:1,decrease:0,net:1},cash:{increase:1,decrease:0,net:1},settlements:{increase:1,decrease:0,net:1,opening:0,closing:1},services:{increase:1,decrease:0,net:1,regionsNet:1},studies:{increase:1,decrease:0,net:1},equipment:{increase:1,decrease:0,net:1},staff:{increase:1,decrease:0,net:1},expenses:{increase:0,decrease:0,net:0}},breakdowns:{revenueByService:[{serviceCode:"=2+2",accrued:1,reversed:0,net:1}],cashByMethod:[],expensesByItem:[],studiesByService:[],equipment:[],staff:[],inventory:[],inventoryByWarehouse:[]}};
  const csv=buildRegisterTurnoverCsv(report,["revenue"]);
  assert.ok(csv.startsWith("\uFEFF"));assert.match(csv,/"'=2\+2"/);assert.match(csv,/Дохід за послугами/);assert.doesNotMatch(csv,/Підсумок/);assert.doesNotMatch(csv,/Склад — загалом/);
});

test("0101 keeps saved views out of the economic registrar graph",async()=>{
  const {db,close}=await freshDb();try{const table=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='saved_report_views'").first();assert.equal(table?.name,"saved_report_views");}finally{close();}
  const core=await import("../lib/business-core.ts");assert.equal(core.REGISTER_TYPES.includes("saved_report_views"),false);assert.equal(core.DOCUMENT_TYPES.includes("saved_report_view"),false);
});
