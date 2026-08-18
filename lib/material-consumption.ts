import { createInventoryDocument } from "./inventory-documents";

export type MaterialConsumptionRow={
  reservationId:number;bookingId:number;bookingCode:string;performedAt:string;
  serviceCode:string;serviceTitle:string;itemId:number;itemName:string;itemUnit:string;
  warehouseId:number;warehouseCode:string;warehouseName:string;
  plannedQuantity:number;draftQuantity:number;postedQuantity:number;remainingQuantity:number;
  status:"open"|"partial"|"draft"|"consumed";
};

type BaseRow=Omit<MaterialConsumptionRow,"remainingQuantity"|"status">;

const BASE=`SELECT r.id AS reservationId,r.booking_id AS bookingId,b.code AS bookingCode,b.performed_at AS performedAt,
  r.service_code AS serviceCode,b.service AS serviceTitle,r.item_id AS itemId,i.name AS itemName,i.unit AS itemUnit,
  r.warehouse_id AS warehouseId,w.code AS warehouseCode,w.name AS warehouseName,
  r.quantity_delta AS plannedQuantity,
  COALESCE(SUM(CASE WHEN d.state='draft' THEN l.quantity ELSE 0 END),0) AS draftQuantity,
  COALESCE(SUM(CASE WHEN d.state='posted' THEN l.quantity ELSE 0 END),0) AS postedQuantity
FROM inventory_reservation_movements r
JOIN bookings b ON b.id=r.booking_id AND b.organization_id=r.organization_id
JOIN inventory_items i ON i.id=r.item_id AND i.organization_id=r.organization_id
JOIN warehouses w ON w.id=r.warehouse_id AND w.organization_id=r.organization_id
LEFT JOIN inventory_document_lines l ON l.organization_id=r.organization_id AND l.reservation_movement_id=r.id
LEFT JOIN business_documents d ON d.id=l.document_id AND d.organization_id=l.organization_id AND d.document_type='inventory_writeoff'
WHERE r.organization_id=? AND r.movement_type='reserve' AND b.status='completed'
  AND EXISTS (
    SELECT 1 FROM inventory_reservation_movements rel
    WHERE rel.organization_id=r.organization_id
      AND rel.appointment_document_id=r.appointment_document_id
      AND rel.requirement_id=r.requirement_id
      AND rel.movement_type='release'
      AND ABS(rel.quantity_delta+r.quantity_delta)<0.000001
  )`;
const GROUP=` GROUP BY r.id,r.booking_id,b.code,b.performed_at,r.service_code,b.service,r.item_id,i.name,i.unit,
  r.warehouse_id,w.code,w.name,r.quantity_delta`;

function hydrate(row:BaseRow):MaterialConsumptionRow{
  const planned=Number(row.plannedQuantity||0),draft=Number(row.draftQuantity||0),posted=Number(row.postedQuantity||0);
  const remaining=Math.max(0,planned-draft-posted);
  const status:MaterialConsumptionRow["status"]=
    posted+0.000001>=planned?"consumed":draft>0.000001?"draft":posted>0.000001?"partial":"open";
  return {...row,plannedQuantity:planned,draftQuantity:draft,postedQuantity:posted,remainingQuantity:remaining,status};
}

export async function listMaterialConsumption(db:D1Database,organizationId:number,limit=150){
  const safe=Math.max(1,Math.min(300,Math.trunc(limit)));
  const rows=await db.prepare(`${BASE}${GROUP} ORDER BY b.performed_at DESC,r.id DESC LIMIT ${safe}`).bind(organizationId).all<BaseRow>();
  return rows.results.map(hydrate);
}

export async function getMaterialConsumption(db:D1Database,organizationId:number,reservationId:number){
  const row=await db.prepare(`${BASE} AND r.id=?${GROUP} LIMIT 1`).bind(organizationId,reservationId).first<BaseRow>();
  return row?hydrate(row):null;
}

function positiveId(value:unknown){const n=Number(value);return Number.isInteger(n)&&n>0?n:null;}
function positiveQuantity(value:unknown){const n=Number(value);return Number.isFinite(n)&&n>0?n:null;}

export async function createMaterialConsumptionDraft(db:D1Database,input:{
  organizationId:number;actorEmail:string;reservationId:number;
  allocations:Array<{lotId?:number;quantity?:number}>;
}){
  const current=await getMaterialConsumption(db,input.organizationId,input.reservationId);
  if(!current)throw new Error("material_consumption_reservation_not_found");
  if(!Array.isArray(input.allocations)||input.allocations.length<1||input.allocations.length>100)
    throw new Error("material_consumption_allocations_required");
  const normalized=input.allocations.map(source=>{
    const lotId=positiveId(source.lotId);if(!lotId)throw new Error("material_consumption_lot_invalid");
    const quantity=positiveQuantity(source.quantity);if(!quantity)throw new Error("material_consumption_quantity_invalid");
    return {lotId,quantity};
  });
  const total=normalized.reduce((sum,row)=>sum+row.quantity,0);
  if(total>current.remainingQuantity+0.000001)throw new Error("inventory_consumption_overallocated");
  const reason=`Фактична витрата за послугою ${current.serviceCode}`;
  const created=await createInventoryDocument(db,{
    organizationId:input.organizationId,actorEmail:input.actorEmail,type:"inventory_writeoff",
    occurredAt:current.performedAt||undefined,
    comment:`Витрата матеріалів за виконаною послугою ${current.serviceCode}`,
    lines:normalized.map(row=>({
      lotId:row.lotId,warehouseId:current.warehouseId,quantity:row.quantity,reason,
      bookingId:current.bookingId,reservationMovementId:current.reservationId,
    })),
  });
  if(!created)throw new Error("material_consumption_create_failed");
  return created;
}
