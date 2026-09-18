import { serviceByCode } from "./catalog";

export type ServiceMaterialRequirementRow = {
  id:number;
  organizationId:number;
  serviceCode:string;
  serviceTitle:string;
  itemId:number;
  itemName:string;
  itemUnit:string;
  warehouseId:number;
  warehouseCode:string;
  warehouseName:string;
  quantity:number;
  active:number;
  createdBy:string;
  createdAt:string;
  updatedBy:string;
  updatedAt:string;
};

const SELECT=`SELECT r.id,r.organization_id AS organizationId,r.service_code AS serviceCode,
  i.name AS itemName,i.unit AS itemUnit,r.item_id AS itemId,
  r.warehouse_id AS warehouseId,w.code AS warehouseCode,w.name AS warehouseName,
  r.quantity,r.active,r.created_by AS createdBy,r.created_at AS createdAt,
  r.updated_by AS updatedBy,r.updated_at AS updatedAt
  FROM service_material_requirements r
  JOIN inventory_items i ON i.id=r.item_id AND i.organization_id=r.organization_id
  JOIN warehouses w ON w.id=r.warehouse_id AND w.organization_id=r.organization_id`;

function positiveId(value:unknown){const n=Number(value);return Number.isInteger(n)&&n>0?n:null;}
function quantity(value:unknown){const n=Number(value);return Number.isFinite(n)&&n>0&&n<=1_000_000?n:null;}
function serviceCode(value:unknown){
  const code=String(value??"").trim().slice(0,80);
  if(!code||!serviceByCode(code))throw new Error("service_material_requirement_service_invalid");
  return code;
}
function hydrate(row:Omit<ServiceMaterialRequirementRow,"serviceTitle">):ServiceMaterialRequirementRow{
  return {...row,serviceTitle:serviceByCode(row.serviceCode)?.title||row.serviceCode};
}

export async function listServiceMaterialRequirements(db:D1Database,organizationId:number,input:{active?:boolean;serviceCode?:string}={}){
  const where=["r.organization_id=?"];const args:Array<string|number>=[organizationId];
  if(input.active!==undefined){where.push("r.active=?");args.push(input.active?1:0);}
  if(input.serviceCode){where.push("r.service_code=?");args.push(input.serviceCode);}
  const rows=await db.prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY r.service_code,r.active DESC,r.id`)
    .bind(...args).all<Omit<ServiceMaterialRequirementRow,"serviceTitle">>();
  return rows.results.map(hydrate);
}

export async function getServiceMaterialRequirement(db:D1Database,organizationId:number,id:number){
  const row=await db.prepare(`${SELECT} WHERE r.organization_id=? AND r.id=? LIMIT 1`)
    .bind(organizationId,id).first<Omit<ServiceMaterialRequirementRow,"serviceTitle">>();
  return row?hydrate(row):null;
}

export async function createServiceMaterialRequirement(db:D1Database,input:{organizationId:number;actorEmail:string;values:Record<string,unknown>}){
  const code=serviceCode(input.values.serviceCode);
  const itemId=positiveId(input.values.itemId);if(!itemId)throw new Error("service_material_requirement_item_invalid");
  const warehouseId=positiveId(input.values.warehouseId);if(!warehouseId)throw new Error("service_material_requirement_warehouse_invalid");
  const qty=quantity(input.values.quantity);if(qty===null)throw new Error("service_material_requirement_quantity_invalid");
  const actor=String(input.actorEmail||"").trim();if(!actor)throw new Error("service_material_requirement_actor_required");
  const result=await db.prepare(`INSERT INTO service_material_requirements
    (organization_id,service_code,item_id,warehouse_id,quantity,active,created_by,updated_by)
    VALUES (?,?,?,?,?,1,?,?)`).bind(input.organizationId,code,itemId,warehouseId,qty,actor,actor).run();
  const id=Number(result.meta.last_row_id||0);if(!id)throw new Error("service_material_requirement_create_failed");
  return getServiceMaterialRequirement(db,input.organizationId,id);
}

export async function deactivateServiceMaterialRequirement(db:D1Database,input:{organizationId:number;id:number;actorEmail:string}){
  const current=await getServiceMaterialRequirement(db,input.organizationId,input.id);if(!current)return null;
  if(current.active===0)return current;
  const actor=String(input.actorEmail||"").trim();if(!actor)throw new Error("service_material_requirement_actor_required");
  await db.prepare(`UPDATE service_material_requirements SET active=0,updated_by=?,updated_at=CURRENT_TIMESTAMP
    WHERE organization_id=? AND id=? AND active=1`).bind(actor,input.organizationId,input.id).run();
  return getServiceMaterialRequirement(db,input.organizationId,input.id);
}
