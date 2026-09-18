import assert from "node:assert/strict";
import test from "node:test";
import { buildServiceMaterialMarginCsv } from "../lib/service-material-margin-csv.ts";

test("service material margin CSV preserves numeric facts and neutralizes spreadsheet formulas",()=>{
  const csv=buildServiceMaterialMarginCsv({
    period:{from:"2026-08-01",to:"2026-08-31"},
    generatedAt:"2026-08-19T17:00:00.000Z",
    scope:"material_contribution",
    summary:{netRevenue:1300,linkedMaterialCost:450,unlinkedMaterialCost:90,contribution:850,marginPct:65.4,serviceCount:2},
    rows:[
      {serviceCode:"ct-chest",serviceTitle:"КТ ОГК",performedNet:1,revenueBookings:1,costBookings:1,netRevenue:800,materialCost:300,contribution:500,marginPct:62.5},
      {serviceCode:"=SUM(A1:A2)",serviceTitle:"+unsafe title",performedNet:0,revenueBookings:0,costBookings:1,netRevenue:0,materialCost:150,contribution:-150,marginPct:null},
    ],
  });
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"Чистий дохід","1300"'));
  assert.ok(csv.includes('"ct-chest","КТ ОГК"'));
  assert.ok(csv.includes('"\'=SUM(A1:A2)","\'+unsafe title"'));
  assert.ok(csv.includes('"-150"'),"negative numeric facts must remain numeric for spreadsheet analysis");
  assert.ok(!csv.includes('"\'-150"'));
});
