const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;

export type RegisterPeriod={from:string;to:string};

function validDate(value:string) {
  if(!DATE_RE.test(value))return false;
  const d=new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;
}

export function normalizeRegisterPeriod(fromValue:unknown,toValue:unknown):RegisterPeriod {
  const from=typeof fromValue==="string"?fromValue.trim():"";
  const to=typeof toValue==="string"?toValue.trim():"";
  if(!validDate(from)||!validDate(to)||from>to)throw new Error("invalid_report_period");
  const days=Math.floor((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000)+1;
  if(days>366)throw new Error("report_period_too_large");
  return {from,to};
}

type Turnover={increase:number;decrease:number;net:number};
type BalanceTurnover=Turnover&{opening:number;closing:number};

async function deltaTurnover(
  db:D1Database,table:string,column:string,organizationId:number,period:RegisterPeriod,dateColumn="occurred_at",
):Promise<Turnover> {
  const row=await db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN ${column}>0 THEN ${column} ELSE 0 END),0) AS increase,
       COALESCE(SUM(CASE WHEN ${column}<0 THEN -${column} ELSE 0 END),0) AS decrease,
       COALESCE(SUM(${column}),0) AS net
     FROM ${table}
     WHERE organization_id=? AND substr(${dateColumn},1,10) BETWEEN ? AND ?`
  ).bind(organizationId,period.from,period.to).first<Turnover>();
  return {increase:Number(row?.increase||0),decrease:Number(row?.decrease||0),net:Number(row?.net||0)};
}

async function settlementTurnover(db:D1Database,organizationId:number,period:RegisterPeriod):Promise<BalanceTurnover> {
  const row=await db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN substr(occurred_at,1,10)<? THEN amount_delta ELSE 0 END),0) AS opening,
       COALESCE(SUM(CASE WHEN substr(occurred_at,1,10) BETWEEN ? AND ? AND amount_delta>0 THEN amount_delta ELSE 0 END),0) AS increase,
       COALESCE(SUM(CASE WHEN substr(occurred_at,1,10) BETWEEN ? AND ? AND amount_delta<0 THEN -amount_delta ELSE 0 END),0) AS decrease,
       COALESCE(SUM(CASE WHEN substr(occurred_at,1,10)<=? THEN amount_delta ELSE 0 END),0) AS closing
     FROM patient_settlement_movements WHERE organization_id=?`
  ).bind(period.from,period.from,period.to,period.from,period.to,period.to,organizationId).first<BalanceTurnover>();
  const opening=Number(row?.opening||0),increase=Number(row?.increase||0),decrease=Number(row?.decrease||0),closing=Number(row?.closing||0);
  return {opening,increase,decrease,net:increase-decrease,closing};
}

// Canonical studies_performed read model. Historical positives may still reference service_delivery,
// while new positives are owned by study_performance and new operational storno rows by study_correction.
// The append-only movement union intentionally spans all three eras without rewriting history.
async function performedStudyTurnover(db:D1Database,organizationId:number,period:RegisterPeriod) {
  const row=await db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN quantity_delta>0 THEN quantity_delta ELSE 0 END),0) AS increase,
       COALESCE(SUM(CASE WHEN quantity_delta<0 THEN -quantity_delta ELSE 0 END),0) AS decrease,
       COALESCE(SUM(quantity_delta),0) AS net,
       COALESCE(SUM(regions_delta),0) AS regionsNet
     FROM (
       SELECT quantity AS quantity_delta,anatomical_regions_count AS regions_delta,occurred_at
       FROM services_delivered_movements WHERE organization_id=?
       UNION ALL
       SELECT quantity_delta,anatomical_regions_delta AS regions_delta,occurred_at
       FROM service_correction_movements WHERE organization_id=?
     ) x
     WHERE substr(occurred_at,1,10) BETWEEN ? AND ?`
  ).bind(organizationId,organizationId,period.from,period.to).first<Turnover&{regionsNet:number}>();
  return {
    increase:Number(row?.increase||0),decrease:Number(row?.decrease||0),net:Number(row?.net||0),regionsNet:Number(row?.regionsNet||0),
  };
}

async function studiesByService(db:D1Database,organizationId:number,period:RegisterPeriod) {
  const rows=await db.prepare(
    `SELECT service_code AS serviceCode,
       COALESCE(SUM(CASE WHEN quantity_delta>0 THEN quantity_delta ELSE 0 END),0) AS performed,
       COALESCE(SUM(CASE WHEN quantity_delta<0 THEN -quantity_delta ELSE 0 END),0) AS reversed,
       COALESCE(SUM(quantity_delta),0) AS net,
       COALESCE(SUM(regions_delta),0) AS regionsNet
     FROM (
       SELECT service_code,quantity AS quantity_delta,anatomical_regions_count AS regions_delta,occurred_at
       FROM services_delivered_movements WHERE organization_id=?
       UNION ALL
       SELECT service_code,quantity_delta,anatomical_regions_delta AS regions_delta,occurred_at
       FROM service_correction_movements WHERE organization_id=?
     ) x
     WHERE substr(occurred_at,1,10) BETWEEN ? AND ?
     GROUP BY service_code
     ORDER BY ABS(net) DESC,service_code
     LIMIT 100`
  ).bind(organizationId,organizationId,period.from,period.to).all();
  return rows.results;
}

async function inventoryBalances(db:D1Database,organizationId:number,period:RegisterPeriod) {
  const rows=await db.prepare(
    `SELECT i.id AS itemId,i.sku,i.name,i.unit,
       COALESCE(SUM(CASE WHEN substr(m.created_at,1,10)<? THEN m.quantity_delta ELSE 0 END),0) AS opening,
       COALESCE(SUM(CASE WHEN substr(m.created_at,1,10) BETWEEN ? AND ? AND m.quantity_delta>0 THEN m.quantity_delta ELSE 0 END),0) AS incoming,
       COALESCE(SUM(CASE WHEN substr(m.created_at,1,10) BETWEEN ? AND ? AND m.quantity_delta<0 THEN -m.quantity_delta ELSE 0 END),0) AS outgoing,
       COALESCE(SUM(CASE WHEN substr(m.created_at,1,10)<=? THEN m.quantity_delta ELSE 0 END),0) AS closing
     FROM inventory_items i
     LEFT JOIN inventory_movements m
       ON m.organization_id=i.organization_id AND m.item_id=i.id AND substr(m.created_at,1,10)<=?
     WHERE i.organization_id=?
     GROUP BY i.id,i.sku,i.name,i.unit
     HAVING opening<>0 OR incoming<>0 OR outgoing<>0 OR closing<>0
     ORDER BY i.name,i.id LIMIT 300`
  ).bind(
    period.from,period.from,period.to,period.from,period.to,period.to,period.to,organizationId,
  ).all();
  return rows.results;
}

async function inventoryBalancesByWarehouse(db:D1Database,organizationId:number,period:RegisterPeriod) {
  const rows=await db.prepare(
    `SELECT m.warehouse_id AS warehouseId,m.warehouse_code AS warehouseCode,m.warehouse_name AS warehouseName,
       i.id AS itemId,i.sku,i.name,i.unit,
       COALESCE(SUM(CASE WHEN substr(m.created_at,1,10)<? THEN m.quantity_delta ELSE 0 END),0) AS opening,
       COALESCE(SUM(CASE WHEN substr(m.created_at,1,10) BETWEEN ? AND ? AND m.quantity_delta>0 THEN m.quantity_delta ELSE 0 END),0) AS incoming,
       COALESCE(SUM(CASE WHEN substr(m.created_at,1,10) BETWEEN ? AND ? AND m.quantity_delta<0 THEN -m.quantity_delta ELSE 0 END),0) AS outgoing,
       COALESCE(SUM(CASE WHEN substr(m.created_at,1,10)<=? THEN m.quantity_delta ELSE 0 END),0) AS closing
     FROM inventory_movements m
     JOIN inventory_items i ON i.organization_id=m.organization_id AND i.id=m.item_id
     WHERE m.organization_id=? AND m.warehouse_id IS NOT NULL AND substr(m.created_at,1,10)<=?
     GROUP BY m.warehouse_id,m.warehouse_code,m.warehouse_name,i.id,i.sku,i.name,i.unit
     HAVING opening<>0 OR incoming<>0 OR outgoing<>0 OR closing<>0
     ORDER BY m.warehouse_name,i.name,m.warehouse_id,i.id LIMIT 500`
  ).bind(
    period.from,period.from,period.to,period.from,period.to,period.to,organizationId,period.to,
  ).all();
  return rows.results;
}

async function revenueByService(db:D1Database,organizationId:number,period:RegisterPeriod) {
  const rows=await db.prepare(
    `SELECT service_code AS serviceCode,
       COALESCE(SUM(CASE WHEN amount_delta>0 THEN amount_delta ELSE 0 END),0) AS accrued,
       COALESCE(SUM(CASE WHEN amount_delta<0 THEN -amount_delta ELSE 0 END),0) AS reversed,
       COALESCE(SUM(amount_delta),0) AS net
     FROM revenue_movements
     WHERE organization_id=? AND substr(occurred_at,1,10) BETWEEN ? AND ?
     GROUP BY service_code ORDER BY ABS(net) DESC,service_code LIMIT 100`
  ).bind(organizationId,period.from,period.to).all();
  return rows.results;
}

async function cashByMethod(db:D1Database,organizationId:number,period:RegisterPeriod) {
  const rows=await db.prepare(
    `SELECT method,
       COALESCE(SUM(CASE WHEN amount_delta>0 THEN amount_delta ELSE 0 END),0) AS incoming,
       COALESCE(SUM(CASE WHEN amount_delta<0 THEN -amount_delta ELSE 0 END),0) AS outgoing,
       COALESCE(SUM(amount_delta),0) AS net
     FROM cash_movements
     WHERE organization_id=? AND substr(occurred_at,1,10) BETWEEN ? AND ?
     GROUP BY method ORDER BY ABS(net) DESC,method LIMIT 50`
  ).bind(organizationId,period.from,period.to).all();
  return rows.results;
}

async function expensesByItem(db:D1Database,organizationId:number,period:RegisterPeriod) {
  const rows=await db.prepare(
    `SELECT e.item_id AS itemId,i.sku,i.name,i.unit,
       COALESCE(SUM(e.amount_delta),0) AS amount,COUNT(*) AS movementCount
     FROM expense_movements e
     JOIN inventory_items i ON i.id=e.item_id AND i.organization_id=e.organization_id
     WHERE e.organization_id=? AND substr(e.occurred_at,1,10) BETWEEN ? AND ?
     GROUP BY e.item_id,i.sku,i.name,i.unit
     ORDER BY amount DESC,i.name,e.item_id LIMIT 200`
  ).bind(organizationId,period.from,period.to).all();
  return rows.results;
}

async function equipmentByUnit(db:D1Database,organizationId:number,period:RegisterPeriod) {
  const rows=await db.prepare(
    `SELECT equipment_id AS equipmentId,
       COALESCE(SUM(CASE WHEN minutes_delta>0 THEN minutes_delta ELSE 0 END),0) AS loadedMinutes,
       COALESCE(SUM(CASE WHEN minutes_delta<0 THEN -minutes_delta ELSE 0 END),0) AS reversedMinutes,
       COALESCE(SUM(minutes_delta),0) AS netMinutes
     FROM equipment_load_movements
     WHERE organization_id=? AND substr(occurred_at,1,10) BETWEEN ? AND ?
     GROUP BY equipment_id ORDER BY ABS(netMinutes) DESC,equipment_id LIMIT 100`
  ).bind(organizationId,period.from,period.to).all();
  return rows.results;
}

async function staffByMember(db:D1Database,organizationId:number,period:RegisterPeriod) {
  const rows=await db.prepare(
    `SELECT member_email AS memberEmail,staff_role AS staffRole,
       COALESCE(SUM(CASE WHEN units_delta>0 THEN units_delta ELSE 0 END),0) AS performed,
       COALESCE(SUM(CASE WHEN units_delta<0 THEN -units_delta ELSE 0 END),0) AS reversed,
       COALESCE(SUM(units_delta),0) AS net
     FROM staff_output_movements
     WHERE organization_id=? AND substr(occurred_at,1,10) BETWEEN ? AND ?
     GROUP BY member_email,staff_role ORDER BY ABS(net) DESC,member_email LIMIT 200`
  ).bind(organizationId,period.from,period.to).all();
  return rows.results;
}

export async function buildRegisterTurnoverReport(db:D1Database,organizationId:number,period:RegisterPeriod) {
  const [revenue,cash,settlements,services,equipment,staff,expenses,inventory,inventoryByWarehouse,revenueServices,cashMethods,expenseRows,equipmentRows,staffRows,studyRows]=await Promise.all([
    deltaTurnover(db,"revenue_movements","amount_delta",organizationId,period),
    deltaTurnover(db,"cash_movements","amount_delta",organizationId,period),
    settlementTurnover(db,organizationId,period),
    performedStudyTurnover(db,organizationId,period),
    deltaTurnover(db,"equipment_load_movements","minutes_delta",organizationId,period),
    deltaTurnover(db,"staff_output_movements","units_delta",organizationId,period),
    deltaTurnover(db,"expense_movements","amount_delta",organizationId,period),
    inventoryBalances(db,organizationId,period),
    inventoryBalancesByWarehouse(db,organizationId,period),
    revenueByService(db,organizationId,period),
    cashByMethod(db,organizationId,period),
    expensesByItem(db,organizationId,period),
    equipmentByUnit(db,organizationId,period),
    staffByMember(db,organizationId,period),
    studiesByService(db,organizationId,period),
  ]);
  const studies={...services};
  return {
    period,
    generatedAt:new Date().toISOString(),
    registers:{revenue,cash,settlements,services,studies,equipment,staff,expenses},
    breakdowns:{revenueByService:revenueServices,cashByMethod:cashMethods,expensesByItem:expenseRows,studiesByService:studyRows,equipment:equipmentRows,staff:staffRows,inventory,inventoryByWarehouse},
  };
}
