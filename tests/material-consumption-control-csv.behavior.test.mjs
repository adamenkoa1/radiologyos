import assert from "node:assert/strict";
import test from "node:test";
import { buildMaterialConsumptionControlCsv } from "../lib/material-consumption-control-csv.ts";

test("material consumption control CSV preserves numeric facts and neutralizes spreadsheet formulas",()=>{
  const csv=buildMaterialConsumptionControlCsv({
    period:{from:"2026-08-01",to:"2026-08-31"},
    generatedAt:"2026-08-19T18:00:00.000Z",
    actualAsOf:"2026-08-19T18:00:00.000Z",
    scope:"material_consumption_control",
    summary:{completedBookings:2,reservationFacts:2,fullyPosted:0,withDraft:1,needsAllocation:1,fullyPostedPct:0,rowCount:2},
    rows:[
      {serviceCode:"ct-control",serviceTitle:"КТ контроль",itemId:1,itemSku:"CTRL",itemName:"Контраст",itemUnit:"мл",warehouseId:1,warehouseCode:"MAIN",warehouseName:"Основний",reservationCount:1,bookingCount:1,plannedQuantity:3,postedQuantity:2,draftQuantity:1,unpostedQuantity:1,unallocatedQuantity:0,coveragePct:66.7,fullyPostedReservations:0,draftReservations:1,needsAllocationReservations:0},
      {serviceCode:"=SUM(A1:A2)",serviceTitle:"+unsafe service",itemId:2,itemSku:"@unsafe-sku",itemName:"-unsafe material",itemUnit:"шт",warehouseId:2,warehouseCode:"=WH",warehouseName:"+unsafe warehouse",reservationCount:1,bookingCount:1,plannedQuantity:2,postedQuantity:0,draftQuantity:0,unpostedQuantity:2,unallocatedQuantity:2,coveragePct:0,fullyPostedReservations:0,draftReservations:0,needsAllocationReservations:1},
    ],
  });
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"Планові позиції","2"'));
  assert.ok(csv.includes('"ct-control","КТ контроль","CTRL","Контраст"'));
  assert.ok(csv.includes('"\'=SUM(A1:A2)","\'+unsafe service","\'@unsafe-sku","\'-unsafe material"'));
  assert.ok(csv.includes('"\'=WH","\'+unsafe warehouse"'));
  assert.ok(csv.includes('"66.7"'),"numeric coverage must remain numeric for spreadsheet analysis");
  assert.ok(!csv.includes('"\'66.7"'));
});
