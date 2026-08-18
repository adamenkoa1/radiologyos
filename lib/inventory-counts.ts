import { resolveWarehouse } from "./warehouses.ts";

export type InventoryCountLineInput={
  lotId:number;
  warehouseId:number;
  countedQuantity:number;
  reason?:string;
};

type InventoryCountDocumentRow={
  id:number;organizationId:number;documentType:"inventory_count";number:string;occurredAt:string;
  state:"draft"|"posted"|"reversed"|"cancelled";comment:string;createdBy:string;createdAt:string;
  postedBy:string;postedAt:string;
};

export type InventoryCountLineRow={
  id:number;organizationId:number;documentId:number;lineNo:number;itemId:number;lotId:number;warehouseId:number;
  warehouseCode:string;warehouseName:string;itemName:string;itemUnit:string;lotNumber:string;
  bookQuantity:number;countedQuantity:number;discrepancyQuantity:number;reason:string;
};

const EPS=0.000001;
function text(value:unknown,max:number){return String(value??"").trim().slice(0,max);}
function positiveInt(value:unknown){const n=Number(value);return Number.isInteger(n)&&n>0?n:null;}
function nonnegativeNumber(value:unknown){const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;}

async function lotForOrg(db:D1Database,organizationId:number,lotId:number){
  return db.prepare(
    `SELECT l.id,l.item_id AS itemId,l.lot_number AS lotNumber,i.name AS itemName,i.unit,i.active
     FROM inventory_lots l
     JOIN inventory_items i ON i.id=l.item_id AND i.organization_id=l.organization_id
     WHERE l.organization_id=? AND l.id=? LIMIT 1`
  ).bind(organizationId,lotId).first<{id:number;itemId:number;lotNumber:string;itemName:string;unit:string;active:number}>();
}

async function bookBalance(db:D1Database,organizationId:number,warehouseId:number,lotId:number){
  const row=await db.prepare(
    `SELECT COALESCE(SUM(quantity_delta),0) AS stock
     FROM inventory_movements
     WHERE organization_id=? AND warehouse_id=? AND lot_id=?`
  ).bind(organizationId,warehouseId,lotId).first<{stock:number}>();
  const stock=Number(row?.stock||0);
  if(!Number.isFinite(stock)||stock<-EPS)throw new Error("inventory_count_invalid_book_balance");
  return Math.abs(stock)<EPS?0:stock;
}

export async function getInventoryCount(db:D1Database,organizationId:number,documentId:number){
  const document=await db.prepare(
    `SELECT id,organization_id AS organizationId,document_type AS documentType,number,
            occurred_at AS occurredAt,state,comment,created_by AS createdBy,created_at AS createdAt,
            posted_by AS postedBy,posted_at AS postedAt
     FROM business_documents
     WHERE organization_id=? AND id=? AND document_type='inventory_count' LIMIT 1`
  ).bind(organizationId,documentId).first<InventoryCountDocumentRow>();
  if(!document)return null;
  const lines=await db.prepare(
    `SELECT id,organization_id AS organizationId,document_id AS documentId,line_no AS lineNo,
            item_id AS itemId,lot_id AS lotId,warehouse_id AS warehouseId,
            warehouse_code AS warehouseCode,warehouse_name AS warehouseName,
            item_name AS itemName,item_unit AS itemUnit,lot_number AS lotNumber,
            book_quantity AS bookQuantity,counted_quantity AS countedQuantity,
            counted_quantity-book_quantity AS discrepancyQuantity,reason
     FROM inventory_count_lines
     WHERE organization_id=? AND document_id=? ORDER BY line_no,id`
  ).bind(organizationId,documentId).all<InventoryCountLineRow>();
  return{document,lines:lines.results};
}

export async function listInventoryCounts(db:D1Database,organizationId:number,limit=150){
  const safeLimit=Math.max(1,Math.min(300,Math.trunc(limit)));
  const rows=await db.prepare(
    `SELECT d.id,d.organization_id AS organizationId,d.document_type AS documentType,d.number,
            d.occurred_at AS occurredAt,d.state,d.comment,d.created_by AS createdBy,d.created_at AS createdAt,
            d.posted_by AS postedBy,d.posted_at AS postedAt,
            COUNT(l.id) AS lineCount,
            COALESCE(SUM(l.book_quantity),0) AS totalBookQuantity,
            COALESCE(SUM(l.counted_quantity),0) AS totalCountedQuantity,
            COALESCE(SUM(l.counted_quantity-l.book_quantity),0) AS discrepancyQuantity
     FROM business_documents d
     LEFT JOIN inventory_count_lines l ON l.organization_id=d.organization_id AND l.document_id=d.id
     WHERE d.organization_id=? AND d.document_type='inventory_count'
     GROUP BY d.id ORDER BY d.occurred_at DESC,d.id DESC LIMIT ${safeLimit}`
  ).bind(organizationId).all<InventoryCountDocumentRow&{lineCount:number;totalBookQuantity:number;totalCountedQuantity:number;discrepancyQuantity:number}>();
  return rows.results;
}

export async function createInventoryCount(db:D1Database,input:{
  organizationId:number;actorEmail:string;occurredAt?:string;comment?:string;lines:InventoryCountLineInput[];
}){
  if(!Array.isArray(input.lines)||input.lines.length<1||input.lines.length>200)throw new Error("inventory_count_lines_required");
  const normalized:Array<{
    itemId:number;lotId:number;warehouseId:number;warehouseCode:string;warehouseName:string;
    itemName:string;itemUnit:string;lotNumber:string;bookQuantity:number;countedQuantity:number;reason:string;
  }>=[];
  const seen=new Set<string>();

  for(const source of input.lines){
    const lotId=positiveInt(source.lotId);if(!lotId)throw new Error("inventory_count_lot_required");
    const warehouseId=positiveInt(source.warehouseId);if(!warehouseId)throw new Error("inventory_count_warehouse_required");
    const countedQuantity=nonnegativeNumber(source.countedQuantity);if(countedQuantity===null)throw new Error("inventory_count_invalid_quantity");
    const bucket=`${warehouseId}:${lotId}`;if(seen.has(bucket))throw new Error("inventory_count_duplicate_bucket");seen.add(bucket);
    const [warehouse,lot]=await Promise.all([
      resolveWarehouse(db,{organizationId:input.organizationId,warehouseId}),
      lotForOrg(db,input.organizationId,lotId),
    ]);
    if(!lot||!lot.active)throw new Error("inventory_count_lot_not_found");
    const bookQuantity=await bookBalance(db,input.organizationId,warehouse.id,lot.id);
    normalized.push({
      itemId:lot.itemId,lotId:lot.id,warehouseId:warehouse.id,warehouseCode:warehouse.code,warehouseName:warehouse.name,
      itemName:lot.itemName,itemUnit:lot.unit,lotNumber:lot.lotNumber,bookQuantity,countedQuantity,
      reason:text(source.reason,500)||"Інвентаризація",
    });
  }

  const occurredAt=text(input.occurredAt,32)||new Date().toISOString();
  const comment=text(input.comment,500);
  const created=await db.prepare(
    `INSERT INTO business_documents (organization_id,document_type,number,occurred_at,state,comment,created_by)
     VALUES (?,'inventory_count','',?,'draft',?,?)`
  ).bind(input.organizationId,occurredAt,comment,input.actorEmail).run();
  const documentId=Number(created.meta.last_row_id||0);if(!documentId)throw new Error("inventory_count_create_failed");
  await db.prepare("UPDATE business_documents SET number=? WHERE organization_id=? AND id=? AND state='draft'")
    .bind(`ІНВ-${String(documentId).padStart(6,"0")}`,input.organizationId,documentId).run();
  try{
    await db.batch(normalized.map((line,index)=>db.prepare(
      `INSERT INTO inventory_count_lines
        (organization_id,document_id,line_no,item_id,lot_id,warehouse_id,warehouse_code,warehouse_name,
         item_name,item_unit,lot_number,book_quantity,counted_quantity,reason)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      input.organizationId,documentId,index+1,line.itemId,line.lotId,line.warehouseId,line.warehouseCode,line.warehouseName,
      line.itemName,line.itemUnit,line.lotNumber,line.bookQuantity,line.countedQuantity,line.reason,
    )));
  }catch(error){
    await db.prepare("DELETE FROM business_documents WHERE organization_id=? AND id=? AND state='draft'")
      .bind(input.organizationId,documentId).run().catch(()=>{});
    throw error;
  }
  return getInventoryCount(db,input.organizationId,documentId);
}

export async function cancelInventoryCount(db:D1Database,organizationId:number,documentId:number){
  const result=await db.prepare(
    `UPDATE business_documents SET state='cancelled'
     WHERE organization_id=? AND id=? AND document_type='inventory_count' AND state='draft'`
  ).bind(organizationId,documentId).run();
  return Number(result.meta.changes||0)===1;
}

export async function postInventoryCount(db:D1Database,input:{organizationId:number;documentId:number;actorEmail:string}){
  const current=await getInventoryCount(db,input.organizationId,input.documentId);
  if(!current)return{ok:false as const,status:404,error:"Документ інвентаризації не знайдено"};
  if(current.document.state==="posted")return{ok:true as const,idempotent:true,document:current};
  if(current.document.state!=="draft")return{ok:false as const,status:409,error:"Провести можна лише чернетку"};
  if(current.lines.length<1)return{ok:false as const,status:409,error:"У документі немає рядків"};
  const postedAt=new Date().toISOString();
  try{
    const result=await db.prepare(
      `UPDATE business_documents SET state='posted',posted_by=?,posted_at=?
       WHERE organization_id=? AND id=? AND document_type='inventory_count' AND state='draft'`
    ).bind(input.actorEmail,postedAt,input.organizationId,input.documentId).run();
    if(Number(result.meta.changes||0)!==1){
      const again=await getInventoryCount(db,input.organizationId,input.documentId);
      if(again?.document.state==="posted")return{ok:true as const,idempotent:true,document:again};
      return{ok:false as const,status:409,error:"Провести можна лише чернетку"};
    }
  }catch(error){
    const message=String(error).toLowerCase();
    if(message.includes("inventory_count_stale_balance"))return{ok:false as const,status:409,error:"Залишок змінився після створення інвентаризації. Створіть новий документ за актуальним залишком"};
    if(message.includes("inventory_negative_stock"))return{ok:false as const,status:409,error:"Фактичний залишок не може створити від’ємний складський баланс"};
    if(message.includes("inventory_reserved_stock_violation"))return{ok:false as const,status:409,error:"Фактичний залишок нижчий за активний резерв матеріалів"};
    throw error;
  }
  return{ok:true as const,idempotent:false,document:await getInventoryCount(db,input.organizationId,input.documentId)};
}
