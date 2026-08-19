const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;

export type MaterialConsumptionControlPeriod={from:string;to:string};

export type MaterialConsumptionControlRow={
  serviceCode:string;serviceTitle:string;
  itemId:number;itemSku:string;itemName:string;itemUnit:string;
  warehouseId:number;warehouseCode:string;warehouseName:string;
  reservationCount:number;bookingCount:number;
  plannedQuantity:number;postedQuantity:number;draftQuantity:number;
  unpostedQuantity:number;unallocatedQuantity:number;coveragePct:number;
  fullyPostedReservations:number;draftReservations:number;needsAllocationReservations:number;
};

function validDate(value:string){
  if(!DATE_RE.test(value))return false;
  const date=new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}

export function normalizeMaterialConsumptionControlPeriod(
  fromValue:unknown,toValue:unknown,defaults:MaterialConsumptionControlPeriod,
):MaterialConsumptionControlPeriod{
  const from=typeof fromValue==="string"&&fromValue.trim()?fromValue.trim():defaults.from;
  const to=typeof toValue==="string"&&toValue.trim()?toValue.trim():defaults.to;
  if(!validDate(from)||!validDate(to)||from>to)throw new Error("invalid_report_period");
  const days=Math.floor((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000)+1;
  if(days>366)throw new Error("report_period_too_large");
  return {from,to};
}

function pct(actual:number,planned:number){
  if(planned<=0)return 0;
  return Math.round((actual/planned)*1000)/10;
}

type RawRow={
  serviceCode:string;serviceTitle:string;
  itemId:number;itemSku:string;itemName:string;itemUnit:string;
  warehouseId:number;warehouseCode:string;warehouseName:string;
  reservationCount:number;bookingCount:number;
  plannedQuantity:number;postedQuantity:number;draftQuantity:number;
  fullyPostedReservations:number;draftReservations:number;needsAllocationReservations:number;
};

export async function buildMaterialConsumptionControlReport(
  db:D1Database,organizationId:number,period:MaterialConsumptionControlPeriod,
){
  const result=await db.prepare(`
    WITH params(organization_id,from_date,to_date) AS (VALUES(?,?,?)),
    current_reserves AS (
      SELECT r.id AS reservationId,r.booking_id AS bookingId,r.service_code AS serviceCode,b.service AS serviceTitle,
        r.item_id AS itemId,i.sku AS itemSku,i.name AS itemName,i.unit AS itemUnit,
        r.warehouse_id AS warehouseId,w.code AS warehouseCode,w.name AS warehouseName,
        r.quantity_delta AS plannedQuantity
      FROM inventory_reservation_movements r
      JOIN business_documents appointment
        ON appointment.id=r.appointment_document_id AND appointment.organization_id=r.organization_id
       AND appointment.document_type='appointment' AND appointment.state='posted'
      JOIN bookings b ON b.id=r.booking_id AND b.organization_id=r.organization_id
      JOIN inventory_items i ON i.id=r.item_id AND i.organization_id=r.organization_id
      JOIN warehouses w ON w.id=r.warehouse_id AND w.organization_id=r.organization_id
      JOIN params p ON p.organization_id=r.organization_id
      WHERE r.movement_type='reserve' AND b.status='completed'
        AND substr(b.performed_at,1,10) BETWEEN p.from_date AND p.to_date
        AND EXISTS (
          SELECT 1 FROM inventory_reservation_movements rel
          WHERE rel.organization_id=r.organization_id
            AND rel.appointment_document_id=r.appointment_document_id
            AND rel.requirement_id=r.requirement_id
            AND rel.movement_type='release'
            AND ABS(rel.quantity_delta+r.quantity_delta)<0.000001
        )
    ),
    facts AS (
      SELECT cr.*,
        COALESCE(SUM(CASE WHEN d.state='draft' THEN l.quantity ELSE 0 END),0) AS draftQuantity,
        COALESCE(SUM(CASE WHEN d.state='posted' AND m.id IS NOT NULL AND m.quantity_delta<0 THEN -m.quantity_delta ELSE 0 END),0) AS postedQuantity
      FROM current_reserves cr
      LEFT JOIN inventory_document_lines l
        ON l.organization_id=? AND l.reservation_movement_id=cr.reservationId
      LEFT JOIN business_documents d
        ON d.id=l.document_id AND d.organization_id=l.organization_id AND d.document_type='inventory_writeoff'
      LEFT JOIN inventory_movements m
        ON m.organization_id=l.organization_id AND m.document_line_id=l.id AND m.movement_type='writeoff'
      GROUP BY cr.reservationId,cr.bookingId,cr.serviceCode,cr.serviceTitle,cr.itemId,cr.itemSku,cr.itemName,cr.itemUnit,
        cr.warehouseId,cr.warehouseCode,cr.warehouseName,cr.plannedQuantity
    )
    SELECT serviceCode,MAX(serviceTitle) AS serviceTitle,
      itemId,MAX(itemSku) AS itemSku,MAX(itemName) AS itemName,MAX(itemUnit) AS itemUnit,
      warehouseId,MAX(warehouseCode) AS warehouseCode,MAX(warehouseName) AS warehouseName,
      COUNT(*) AS reservationCount,COUNT(DISTINCT bookingId) AS bookingCount,
      SUM(plannedQuantity) AS plannedQuantity,SUM(postedQuantity) AS postedQuantity,SUM(draftQuantity) AS draftQuantity,
      SUM(CASE WHEN postedQuantity+0.000001>=plannedQuantity THEN 1 ELSE 0 END) AS fullyPostedReservations,
      SUM(CASE WHEN postedQuantity+0.000001<plannedQuantity AND draftQuantity>0.000001 THEN 1 ELSE 0 END) AS draftReservations,
      SUM(CASE WHEN postedQuantity+draftQuantity+0.000001<plannedQuantity THEN 1 ELSE 0 END) AS needsAllocationReservations
    FROM facts
    GROUP BY serviceCode,itemId,warehouseId
    ORDER BY (SUM(plannedQuantity)-SUM(postedQuantity)) DESC,serviceCode,itemName,warehouseName
    LIMIT 500
  `).bind(organizationId,period.from,period.to,organizationId).all<RawRow>();

  const rows:MaterialConsumptionControlRow[]=result.results.map(raw=>{
    const plannedQuantity=Number(raw.plannedQuantity||0);
    const postedQuantity=Number(raw.postedQuantity||0);
    const draftQuantity=Number(raw.draftQuantity||0);
    return {
      serviceCode:String(raw.serviceCode||""),serviceTitle:String(raw.serviceTitle||raw.serviceCode||""),
      itemId:Number(raw.itemId),itemSku:String(raw.itemSku||""),itemName:String(raw.itemName||""),itemUnit:String(raw.itemUnit||""),
      warehouseId:Number(raw.warehouseId),warehouseCode:String(raw.warehouseCode||""),warehouseName:String(raw.warehouseName||""),
      reservationCount:Number(raw.reservationCount||0),bookingCount:Number(raw.bookingCount||0),
      plannedQuantity,postedQuantity,draftQuantity,
      unpostedQuantity:Math.max(0,plannedQuantity-postedQuantity),
      unallocatedQuantity:Math.max(0,plannedQuantity-postedQuantity-draftQuantity),
      coveragePct:pct(postedQuantity,plannedQuantity),
      fullyPostedReservations:Number(raw.fullyPostedReservations||0),
      draftReservations:Number(raw.draftReservations||0),
      needsAllocationReservations:Number(raw.needsAllocationReservations||0),
    };
  });

  const reservationFacts=rows.reduce((sum,row)=>sum+row.reservationCount,0);
  const fullyPosted=rows.reduce((sum,row)=>sum+row.fullyPostedReservations,0);
  const withDraft=rows.reduce((sum,row)=>sum+row.draftReservations,0);
  const needsAllocation=rows.reduce((sum,row)=>sum+row.needsAllocationReservations,0);
  const completedBookings=await db.prepare(`
    SELECT COUNT(DISTINCT r.booking_id) AS n
    FROM inventory_reservation_movements r
    JOIN business_documents appointment
      ON appointment.id=r.appointment_document_id AND appointment.organization_id=r.organization_id
     AND appointment.document_type='appointment' AND appointment.state='posted'
    JOIN bookings b ON b.id=r.booking_id AND b.organization_id=r.organization_id
    WHERE r.organization_id=? AND r.movement_type='reserve' AND b.status='completed'
      AND substr(b.performed_at,1,10) BETWEEN ? AND ?
      AND EXISTS (
        SELECT 1 FROM inventory_reservation_movements rel
        WHERE rel.organization_id=r.organization_id
          AND rel.appointment_document_id=r.appointment_document_id
          AND rel.requirement_id=r.requirement_id
          AND rel.movement_type='release'
          AND ABS(rel.quantity_delta+r.quantity_delta)<0.000001
      )
  `).bind(organizationId,period.from,period.to).first<{n:number}>();

  const generatedAt=new Date().toISOString();
  return {
    period,generatedAt,actualAsOf:generatedAt,scope:"material_consumption_control" as const,
    summary:{
      completedBookings:Number(completedBookings?.n||0),reservationFacts,fullyPosted,withDraft,needsAllocation,
      fullyPostedPct:reservationFacts?Math.round((fullyPosted/reservationFacts)*1000)/10:0,
      rowCount:rows.length,
    },
    rows,
  };
}
