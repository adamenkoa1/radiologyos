const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;

export type ServiceMaterialMarginPeriod={from:string;to:string};

export type ServiceMaterialMarginRow={
  serviceCode:string;
  serviceTitle:string;
  performedNet:number;
  revenueBookings:number;
  costBookings:number;
  netRevenue:number;
  materialCost:number;
  contribution:number;
  marginPct:number|null;
};

function validDate(value:string){
  if(!DATE_RE.test(value))return false;
  const date=new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}

export function normalizeServiceMaterialMarginPeriod(
  fromValue:unknown,toValue:unknown,defaults:ServiceMaterialMarginPeriod,
):ServiceMaterialMarginPeriod{
  const from=typeof fromValue==="string"&&fromValue.trim()?fromValue.trim():defaults.from;
  const to=typeof toValue==="string"&&toValue.trim()?toValue.trim():defaults.to;
  if(!validDate(from)||!validDate(to)||from>to)throw new Error("invalid_report_period");
  const days=Math.floor((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000)+1;
  if(days>366)throw new Error("report_period_too_large");
  return {from,to};
}

function marginPct(revenue:number,contribution:number){
  if(revenue<=0)return null;
  return Math.round((contribution/revenue)*1000)/10;
}

type RawRow={
  serviceCode:string;serviceTitle:string;performedNet:number;revenueBookings:number;costBookings:number;
  netRevenue:number;materialCost:number;
};

export async function buildServiceMaterialMarginReport(
  db:D1Database,organizationId:number,period:ServiceMaterialMarginPeriod,
){
  const result=await db.prepare(`
    WITH params(organization_id,from_date,to_date) AS (VALUES(?,?,?)),
    performed AS (
      SELECT service_code AS serviceCode,COALESCE(SUM(quantity_delta),0) AS performedNet
      FROM (
        SELECT m.service_code,m.quantity AS quantity_delta
        FROM services_delivered_movements m,params p
        WHERE m.organization_id=p.organization_id
          AND substr(m.occurred_at,1,10) BETWEEN p.from_date AND p.to_date
        UNION ALL
        SELECT c.service_code,c.quantity_delta
        FROM service_correction_movements c,params p
        WHERE c.organization_id=p.organization_id
          AND substr(c.occurred_at,1,10) BETWEEN p.from_date AND p.to_date
      ) movements
      GROUP BY service_code
    ),
    revenue AS (
      SELECT r.service_code AS serviceCode,
        COALESCE(SUM(r.amount_delta),0) AS netRevenue,
        COUNT(DISTINCT r.booking_id) AS revenueBookings
      FROM revenue_movements r,params p
      WHERE r.organization_id=p.organization_id
        AND substr(r.occurred_at,1,10) BETWEEN p.from_date AND p.to_date
      GROUP BY r.service_code
    ),
    cost AS (
      SELECT b.service_code AS serviceCode,
        COALESCE(SUM(e.amount_delta),0) AS materialCost,
        COUNT(DISTINCT e.booking_id) AS costBookings
      FROM expense_movements e
      JOIN bookings b ON b.organization_id=e.organization_id AND b.id=e.booking_id
      JOIN params p ON p.organization_id=e.organization_id
      WHERE e.booking_id IS NOT NULL
        AND substr(e.occurred_at,1,10) BETWEEN p.from_date AND p.to_date
      GROUP BY b.service_code
    ),
    codes AS (
      SELECT serviceCode FROM performed
      UNION SELECT serviceCode FROM revenue
      UNION SELECT serviceCode FROM cost
    )
    SELECT codes.serviceCode AS serviceCode,
      COALESCE(
        (SELECT sd.service_title FROM service_delivery_details sd,params p
         WHERE sd.organization_id=p.organization_id AND sd.service_code=codes.serviceCode
         ORDER BY sd.document_id DESC LIMIT 1),
        (SELECT b.service FROM bookings b,params p
         WHERE b.organization_id=p.organization_id AND b.service_code=codes.serviceCode
         ORDER BY b.id DESC LIMIT 1),
        codes.serviceCode
      ) AS serviceTitle,
      COALESCE(performed.performedNet,0) AS performedNet,
      COALESCE(revenue.revenueBookings,0) AS revenueBookings,
      COALESCE(cost.costBookings,0) AS costBookings,
      COALESCE(revenue.netRevenue,0) AS netRevenue,
      COALESCE(cost.materialCost,0) AS materialCost
    FROM codes
    LEFT JOIN performed ON performed.serviceCode=codes.serviceCode
    LEFT JOIN revenue ON revenue.serviceCode=codes.serviceCode
    LEFT JOIN cost ON cost.serviceCode=codes.serviceCode
    ORDER BY ABS(COALESCE(revenue.netRevenue,0)-COALESCE(cost.materialCost,0)) DESC,codes.serviceCode
    LIMIT 300
  `).bind(organizationId,period.from,period.to).all<RawRow>();

  const unlinked=await db.prepare(`
    SELECT COALESCE(SUM(e.amount_delta),0) AS amount
    FROM expense_movements e
    LEFT JOIN bookings b ON b.organization_id=e.organization_id AND b.id=e.booking_id
    WHERE e.organization_id=?
      AND substr(e.occurred_at,1,10) BETWEEN ? AND ?
      AND (e.booking_id IS NULL OR b.id IS NULL)
  `).bind(organizationId,period.from,period.to).first<{amount:number}>();

  const rows:ServiceMaterialMarginRow[]=result.results.map(raw=>{
    const netRevenue=Number(raw.netRevenue||0);
    const materialCost=Number(raw.materialCost||0);
    const contribution=netRevenue-materialCost;
    return {
      serviceCode:String(raw.serviceCode||""),
      serviceTitle:String(raw.serviceTitle||raw.serviceCode||""),
      performedNet:Number(raw.performedNet||0),
      revenueBookings:Number(raw.revenueBookings||0),
      costBookings:Number(raw.costBookings||0),
      netRevenue,materialCost,contribution,marginPct:marginPct(netRevenue,contribution),
    };
  });

  const netRevenue=rows.reduce((sum,row)=>sum+row.netRevenue,0);
  const linkedMaterialCost=rows.reduce((sum,row)=>sum+row.materialCost,0);
  const contribution=netRevenue-linkedMaterialCost;
  const unlinkedMaterialCost=Number(unlinked?.amount||0);
  return {
    period,
    generatedAt:new Date().toISOString(),
    scope:"material_contribution" as const,
    summary:{
      netRevenue,
      linkedMaterialCost,
      unlinkedMaterialCost,
      contribution,
      marginPct:marginPct(netRevenue,contribution),
      serviceCount:rows.length,
    },
    rows,
  };
}
