import { resolveWarehouse } from "./warehouses";

export type InventoryTransferLineInput={
  lotId:number;
  sourceWarehouseId:number;
  destinationWarehouseId:number;
  quantity:number;
  reason?:string;
};

type TransferDocumentRow={
  id:number;organizationId:number;documentType:"inventory_transfer";number:string;occurredAt:string;
  state:"draft"|"posted"|"reversed"|"cancelled";comment:string;createdBy:string;createdAt:string;
  postedBy:string;postedAt:string;
};

export type InventoryTransferLineRow={
  id:number;organizationId:number;documentId:number;lineNo:number;itemId:number;itemName:string;unit:string;
  lotId:number;lotNumber:string;expiresOn:string;supplier:string;quantity:number;reason:string;
  sourceWarehouseId:number;sourceWarehouseCode:string;sourceWarehouseName:string;
  destinationWarehouseId:number;destinationWarehouseCode:string;destinationWarehouseName:string;
};

function text(value:unknown,max:number){return String(value??"").trim().slice(0,max);}
function positiveInt(value:unknown){const n=Number(value);return Number.isInteger(n)&&n>0?n:null;}
function positiveNumber(value:unknown){const n=Number(value);return Number.isFinite(n)&&n>0?n:null;}

async function lotForOrg(db:D1Database,organizationId:number,lotId:number){
  return db.prepare(
    `SELECT l.id,l.item_id AS itemId,l.lot_number AS lotNumber,l.expires_on AS expiresOn,l.supplier,
            l.supplier_counterparty_id AS supplierCounterpartyId,i.name AS itemName,i.unit,i.active
     FROM inventory_lots l
     JOIN inventory_items i ON i.id=l.item_id AND i.organization_id=l.organization_id
     WHERE l.organization_id=? AND l.id=? LIMIT 1`
  ).bind(organizationId,lotId).first<{
    id:number;itemId:number;lotNumber:string;expiresOn:string;supplier:string;supplierCounterpartyId:number|null;
    itemName:string;unit:string;active:number;
  }>();
}

export async function getInventoryTransfer(db:D1Database,organizationId:number,documentId:number){
  const document=await db.prepare(
    `SELECT id,organization_id AS organizationId,document_type AS documentType,number,
            occurred_at AS occurredAt,state,comment,created_by AS createdBy,created_at AS createdAt,
            posted_by AS postedBy,posted_at AS postedAt
     FROM business_documents
     WHERE organization_id=? AND id=? AND document_type='inventory_transfer' LIMIT 1`
  ).bind(organizationId,documentId).first<TransferDocumentRow>();
  if(!document)return null;
  const lines=await db.prepare(
    `SELECT l.id,l.organization_id AS organizationId,l.document_id AS documentId,l.line_no AS lineNo,
            l.item_id AS itemId,i.name AS itemName,i.unit,l.lot_id AS lotId,l.lot_number AS lotNumber,
            l.expires_on AS expiresOn,l.supplier,l.quantity,l.reason,
            l.warehouse_id AS sourceWarehouseId,l.warehouse_code AS sourceWarehouseCode,l.warehouse_name AS sourceWarehouseName,
            l.destination_warehouse_id AS destinationWarehouseId,
            l.destination_warehouse_code AS destinationWarehouseCode,l.destination_warehouse_name AS destinationWarehouseName
     FROM inventory_document_lines l
     JOIN inventory_items i ON i.id=l.item_id AND i.organization_id=l.organization_id
     WHERE l.organization_id=? AND l.document_id=? ORDER BY l.line_no,l.id`
  ).bind(organizationId,documentId).all<InventoryTransferLineRow>();
  return{document,lines:lines.results};
}

export async function listInventoryTransfers(db:D1Database,organizationId:number,limit=150){
  const safeLimit=Math.max(1,Math.min(300,Math.trunc(limit)));
  const rows=await db.prepare(
    `SELECT d.id,d.organization_id AS organizationId,d.document_type AS documentType,d.number,
            d.occurred_at AS occurredAt,d.state,d.comment,d.created_by AS createdBy,d.created_at AS createdAt,
            d.posted_by AS postedBy,d.posted_at AS postedAt,COUNT(l.id) AS lineCount,COALESCE(SUM(l.quantity),0) AS totalQuantity
     FROM business_documents d
     LEFT JOIN inventory_document_lines l ON l.organization_id=d.organization_id AND l.document_id=d.id
     WHERE d.organization_id=? AND d.document_type='inventory_transfer'
     GROUP BY d.id ORDER BY d.occurred_at DESC,d.id DESC LIMIT ${safeLimit}`
  ).bind(organizationId).all<TransferDocumentRow&{lineCount:number;totalQuantity:number}>();
  return rows.results;
}

export async function createInventoryTransfer(db:D1Database,input:{
  organizationId:number;actorEmail:string;occurredAt?:string;comment?:string;lines:InventoryTransferLineInput[];
}){
  if(!Array.isArray(input.lines)||input.lines.length<1||input.lines.length>100)throw new Error("inventory_transfer_lines_required");
  const normalized:Array<{
    itemId:number;lotId:number;lotNumber:string;expiresOn:string;supplier:string;supplierCounterpartyId:number|null;
    quantity:number;reason:string;sourceWarehouseId:number;sourceWarehouseCode:string;sourceWarehouseName:string;
    destinationWarehouseId:number;destinationWarehouseCode:string;destinationWarehouseName:string;
  }>=[];

  for(const source of input.lines){
    const lotId=positiveInt(source.lotId);if(!lotId)throw new Error("inventory_transfer_lot_required");
    const qty=positiveNumber(source.quantity);if(!qty)throw new Error("inventory_transfer_invalid_quantity");
    const sourceWarehouseId=positiveInt(source.sourceWarehouseId);
    const destinationWarehouseId=positiveInt(source.destinationWarehouseId);
    if(!sourceWarehouseId||!destinationWarehouseId)throw new Error("inventory_transfer_warehouse_required");
    if(sourceWarehouseId===destinationWarehouseId)throw new Error("inventory_transfer_same_warehouse");
    const [from,to,lot]=await Promise.all([
      resolveWarehouse(db,{organizationId:input.organizationId,warehouseId:sourceWarehouseId}),
      resolveWarehouse(db,{organizationId:input.organizationId,warehouseId:destinationWarehouseId}),
      lotForOrg(db,input.organizationId,lotId),
    ]);
    if(!lot||!lot.active)throw new Error("inventory_transfer_lot_not_found");
    normalized.push({
      itemId:lot.itemId,lotId:lot.id,lotNumber:lot.lotNumber,expiresOn:lot.expiresOn,supplier:lot.supplier,
      supplierCounterpartyId:lot.supplierCounterpartyId,quantity:qty,
      reason:text(source.reason,500)||"Переміщення між складами",
      sourceWarehouseId:from.id,sourceWarehouseCode:from.code,sourceWarehouseName:from.name,
      destinationWarehouseId:to.id,destinationWarehouseCode:to.code,destinationWarehouseName:to.name,
    });
  }

  const occurredAt=text(input.occurredAt,32)||new Date().toISOString();
  const comment=text(input.comment,500);
  const created=await db.prepare(
    `INSERT INTO business_documents (organization_id,document_type,number,occurred_at,state,comment,created_by)
     VALUES (?,'inventory_transfer','',?,'draft',?,?)`
  ).bind(input.organizationId,occurredAt,comment,input.actorEmail).run();
  const documentId=Number(created.meta.last_row_id||0);if(!documentId)throw new Error("inventory_transfer_create_failed");
  await db.prepare("UPDATE business_documents SET number=? WHERE organization_id=? AND id=? AND state='draft'")
    .bind(`ПМ-${String(documentId).padStart(6,"0")}`,input.organizationId,documentId).run();
  try{
    await db.batch(normalized.map((line,index)=>db.prepare(
      `INSERT INTO inventory_document_lines
        (organization_id,document_id,line_no,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,
         destination_warehouse_id,destination_warehouse_code,destination_warehouse_name,
         lot_number,expires_on,supplier,supplier_counterparty_id,quantity,reason,booking_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`
    ).bind(
      input.organizationId,documentId,index+1,line.itemId,line.lotId,
      line.sourceWarehouseId,line.sourceWarehouseCode,line.sourceWarehouseName,
      line.destinationWarehouseId,line.destinationWarehouseCode,line.destinationWarehouseName,
      line.lotNumber,line.expiresOn,line.supplier,line.supplierCounterpartyId,line.quantity,line.reason,
    )));
  }catch(error){
    await db.prepare("DELETE FROM business_documents WHERE organization_id=? AND id=? AND state='draft'")
      .bind(input.organizationId,documentId).run().catch(()=>{});
    throw error;
  }
  return getInventoryTransfer(db,input.organizationId,documentId);
}

export async function cancelInventoryTransfer(db:D1Database,organizationId:number,documentId:number){
  const result=await db.prepare(
    `UPDATE business_documents SET state='cancelled'
     WHERE organization_id=? AND id=? AND document_type='inventory_transfer' AND state='draft'`
  ).bind(organizationId,documentId).run();
  return Number(result.meta.changes||0)===1;
}

export async function postInventoryTransfer(db:D1Database,input:{organizationId:number;documentId:number;actorEmail:string}){
  const current=await getInventoryTransfer(db,input.organizationId,input.documentId);
  if(!current)return{ok:false as const,status:404,error:"Документ переміщення не знайдено"};
  if(current.document.state==="posted")return{ok:true as const,idempotent:true,document:current};
  if(current.document.state!=="draft")return{ok:false as const,status:409,error:"Провести можна лише чернетку"};
  if(current.lines.length<1)return{ok:false as const,status:409,error:"У документі немає рядків"};

  const required=new Map<string,{warehouseId:number;lotId:number;quantity:number}>();
  for(const line of current.lines){
    if(line.sourceWarehouseId===line.destinationWarehouseId)return{ok:false as const,status:409,error:"Склад-відправник і склад-одержувач мають відрізнятися"};
    const key=`${line.sourceWarehouseId}:${line.lotId}`;
    const prior=required.get(key);
    required.set(key,{warehouseId:line.sourceWarehouseId,lotId:line.lotId,quantity:(prior?.quantity||0)+Number(line.quantity)});
  }
  for(const value of required.values()){
    const balance=await db.prepare(
      `SELECT COALESCE(SUM(quantity_delta),0) AS stock FROM inventory_movements
       WHERE organization_id=? AND warehouse_id=? AND lot_id=?`
    ).bind(input.organizationId,value.warehouseId,value.lotId).first<{stock:number}>();
    if(Number(balance?.stock||0)+0.000001<value.quantity){
      return{ok:false as const,status:409,error:"Недостатній залишок у партії на складі-відправнику"};
    }
  }

  const postedAt=new Date().toISOString();
  const statements:D1PreparedStatement[]=[
    db.prepare(
      `UPDATE business_documents SET state='posted',posted_by=?,posted_at=?
       WHERE organization_id=? AND id=? AND document_type='inventory_transfer' AND state='draft'`
    ).bind(input.actorEmail,postedAt,input.organizationId,input.documentId),
  ];
  for(const line of current.lines){
    statements.push(db.prepare(
      `INSERT INTO inventory_movements
        (organization_id,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,movement_type,quantity_delta,
         reason,booking_id,actor_email,document_id,document_line_id)
       VALUES (?,?,?,?,?,?, 'transfer_out', ?,?,NULL,?,?,?)`
    ).bind(
      input.organizationId,line.itemId,line.lotId,line.sourceWarehouseId,line.sourceWarehouseCode,line.sourceWarehouseName,
      -Number(line.quantity),line.reason,input.actorEmail,input.documentId,line.id,
    ));
    statements.push(db.prepare(
      `INSERT INTO inventory_movements
        (organization_id,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,movement_type,quantity_delta,
         reason,booking_id,actor_email,document_id,document_line_id)
       VALUES (?,?,?,?,?,?, 'transfer_in', ?,?,NULL,?,?,?)`
    ).bind(
      input.organizationId,line.itemId,line.lotId,line.destinationWarehouseId,line.destinationWarehouseCode,line.destinationWarehouseName,
      Number(line.quantity),line.reason,input.actorEmail,input.documentId,line.id,
    ));
  }
  try{
    await db.batch(statements);
  }catch(error){
    const message=String(error).toLowerCase();
    if(message.includes("unique")){
      const again=await getInventoryTransfer(db,input.organizationId,input.documentId);
      if(again?.document.state==="posted")return{ok:true as const,idempotent:true,document:again};
    }
    if(message.includes("inventory_negative_stock")){
      return{ok:false as const,status:409,error:"Недостатній залишок у партії на складі-відправнику"};
    }
    throw error;
  }
  return{ok:true as const,idempotent:false,document:await getInventoryTransfer(db,input.organizationId,input.documentId)};
}
