export type WarehouseRow={
  id:number;organizationId:number;code:string;name:string;active:number;isDefault:number;createdAt:string;updatedAt:string;
};

const SELECT=`SELECT id,organization_id AS organizationId,code,name,active,is_default AS isDefault,
                     created_at AS createdAt,updated_at AS updatedAt FROM warehouses`;

function text(value:unknown,max:number){return String(value??"").trim().slice(0,max);}
function flag(value:unknown){return value===false||value===0||value==="0"?0:1;}

export async function getWarehouse(db:D1Database,organizationId:number,id:number){
  return db.prepare(`${SELECT} WHERE organization_id=? AND id=? LIMIT 1`).bind(organizationId,id).first<WarehouseRow>();
}

export async function listWarehouses(db:D1Database,organizationId:number,input:{active?:boolean}={}){
  const where=["organization_id=?"];const args:Array<number>=[organizationId];
  if(input.active!==undefined){where.push("active=?");args.push(input.active?1:0);}
  const rows=await db.prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY active DESC,is_default DESC,name,id`)
    .bind(...args).all<WarehouseRow>();
  return rows.results;
}

export function normalizeWarehouseInput(input:Record<string,unknown>){
  const name=text(input.name,180);if(!name)throw new Error("warehouse_name_required");
  const code=text(input.code,80);const active=input.active===undefined?1:flag(input.active);
  const isDefault=input.isDefault===undefined?0:flag(input.isDefault);
  if(isDefault&&!active)throw new Error("warehouse_default_must_be_active");
  return{name,code,active,isDefault};
}

async function applyDefault(db:D1Database,organizationId:number,id:number){
  await db.batch([
    db.prepare(`UPDATE warehouses SET is_default=0,updated_at=CURRENT_TIMESTAMP
                WHERE organization_id=? AND id<>? AND is_default=1`).bind(organizationId,id),
    db.prepare(`UPDATE warehouses SET is_default=1,active=1,updated_at=CURRENT_TIMESTAMP
                WHERE organization_id=? AND id=?`).bind(organizationId,id),
  ]);
}

export async function createWarehouse(db:D1Database,input:{organizationId:number;values:Record<string,unknown>}){
  const v=normalizeWarehouseInput(input.values);
  const result=await db.prepare(`INSERT INTO warehouses (organization_id,code,name,active,is_default)
                                 VALUES (?,?,?,?,0)`).bind(input.organizationId,v.code,v.name,v.active).run();
  const id=Number(result.meta.last_row_id||0);if(!id)throw new Error("warehouse_create_failed");
  if(v.isDefault)await applyDefault(db,input.organizationId,id);
  return getWarehouse(db,input.organizationId,id);
}

export async function updateWarehouse(db:D1Database,input:{organizationId:number;id:number;values:Record<string,unknown>}){
  const current=await getWarehouse(db,input.organizationId,input.id);if(!current)return null;
  const v=normalizeWarehouseInput({
    name:input.values.name===undefined?current.name:input.values.name,
    code:input.values.code===undefined?current.code:input.values.code,
    active:input.values.active===undefined?!!current.active:input.values.active,
    isDefault:input.values.isDefault===undefined?!!current.isDefault:input.values.isDefault,
  });
  if(current.isDefault&&(!v.active||!v.isDefault)){
    const replacement=await db.prepare(`SELECT id FROM warehouses
      WHERE organization_id=? AND id<>? AND active=1 ORDER BY is_default DESC,id LIMIT 1`)
      .bind(input.organizationId,input.id).first<{id:number}>();
    if(!replacement)throw new Error("warehouse_default_replacement_required");
    await applyDefault(db,input.organizationId,replacement.id);
  }
  await db.prepare(`UPDATE warehouses SET code=?,name=?,active=?,is_default=0,updated_at=CURRENT_TIMESTAMP
                    WHERE organization_id=? AND id=?`)
    .bind(v.code,v.name,v.active,input.organizationId,input.id).run();
  if(v.isDefault)await applyDefault(db,input.organizationId,input.id);
  return getWarehouse(db,input.organizationId,input.id);
}

export async function resolveWarehouse(db:D1Database,input:{organizationId:number;warehouseId?:number|null}){
  if(input.warehouseId){
    const row=await db.prepare(`${SELECT} WHERE organization_id=? AND id=? AND active=1 LIMIT 1`)
      .bind(input.organizationId,input.warehouseId).first<WarehouseRow>();
    if(!row)throw new Error("inventory_document_warehouse_not_found");
    return row;
  }
  const row=await db.prepare(`${SELECT} WHERE organization_id=? AND active=1 ORDER BY is_default DESC,id LIMIT 1`)
    .bind(input.organizationId).first<WarehouseRow>();
  if(!row)throw new Error("inventory_document_warehouse_not_found");
  return row;
}
