const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;

export type MaterialConsumptionDrilldown={
  serviceCode:string;
  itemId:number;
  warehouseId:number;
  from:string;
  to:string;
};

type DrilldownRow={
  serviceCode:string;
  itemId:number;
  warehouseId:number;
  performedAt:string;
};

function validDate(value:string){
  if(!DATE_RE.test(value))return false;
  const date=new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}

export function parseMaterialConsumptionDrilldown(params:URLSearchParams):MaterialConsumptionDrilldown|null{
  const serviceCode=(params.get("serviceCode")||"").trim();
  const itemId=Number(params.get("itemId"));
  const warehouseId=Number(params.get("warehouseId"));
  const from=(params.get("from")||"").trim();
  const to=(params.get("to")||"").trim();
  if(!serviceCode||serviceCode.length>120)return null;
  if(!Number.isInteger(itemId)||itemId<=0||!Number.isInteger(warehouseId)||warehouseId<=0)return null;
  if(!validDate(from)||!validDate(to)||from>to)return null;
  return {serviceCode,itemId,warehouseId,from,to};
}

export function buildMaterialConsumptionDrilldownUrl(filter:MaterialConsumptionDrilldown){
  return `/staff/inventory/material-consumption?${new URLSearchParams({
    serviceCode:filter.serviceCode,
    itemId:String(filter.itemId),
    warehouseId:String(filter.warehouseId),
    from:filter.from,
    to:filter.to,
  }).toString()}`;
}

export function matchesMaterialConsumptionDrilldown(row:DrilldownRow,filter:MaterialConsumptionDrilldown){
  const performedDate=String(row.performedAt||"").slice(0,10);
  return row.serviceCode===filter.serviceCode
    &&row.itemId===filter.itemId
    &&row.warehouseId===filter.warehouseId
    &&performedDate>=filter.from
    &&performedDate<=filter.to;
}
