import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMaterialConsumptionDrilldownUrl,
  matchesMaterialConsumptionDrilldown,
  parseMaterialConsumptionDrilldown,
} from "../lib/material-consumption-drilldown.ts";

const filter={serviceCode:"ct-control",itemId:7,warehouseId:3,from:"2026-08-01",to:"2026-08-31"};

test("material consumption drilldown round-trips only report grouping and period",()=>{
  const url=buildMaterialConsumptionDrilldownUrl(filter);
  const parsed=parseMaterialConsumptionDrilldown(new URL(url,"https://radiologyos.test").searchParams);
  assert.deepEqual(parsed,filter);
  assert.equal(new URL(url,"https://radiologyos.test").pathname,"/staff/inventory/material-consumption");
});

test("material consumption drilldown matches exact service item warehouse and performed date",()=>{
  const row={serviceCode:"ct-control",itemId:7,warehouseId:3,performedAt:"2026-08-19T10:30:00.000Z"};
  assert.equal(matchesMaterialConsumptionDrilldown(row,filter),true);
  assert.equal(matchesMaterialConsumptionDrilldown({...row,itemId:8},filter),false);
  assert.equal(matchesMaterialConsumptionDrilldown({...row,warehouseId:4},filter),false);
  assert.equal(matchesMaterialConsumptionDrilldown({...row,serviceCode:"xray"},filter),false);
  assert.equal(matchesMaterialConsumptionDrilldown({...row,performedAt:"2026-09-01T00:00:00.000Z"},filter),false);
});

test("material consumption drilldown rejects partial or malformed URL authority",()=>{
  assert.equal(parseMaterialConsumptionDrilldown(new URLSearchParams("serviceCode=ct-control&itemId=7&warehouseId=3&from=2026-08-01")),null);
  assert.equal(parseMaterialConsumptionDrilldown(new URLSearchParams("serviceCode=ct-control&itemId=-1&warehouseId=3&from=2026-08-01&to=2026-08-31")),null);
  assert.equal(parseMaterialConsumptionDrilldown(new URLSearchParams("serviceCode=ct-control&itemId=7&warehouseId=3&from=2026-09-01&to=2026-08-31")),null);
});
