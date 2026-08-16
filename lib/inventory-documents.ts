import type { DocumentState } from "./business-core";
import { getActiveSupplierCounterparty } from "./counterparties";

export type InventoryDocumentType = "inventory_receipt" | "inventory_writeoff";

export type InventoryDocumentLineInput = {
  itemId?: number;
  lotId?: number;
  quantity: number;
  lotNumber?: string;
  expiresOn?: string;
  supplier?: string;
  supplierCounterpartyId?: number | null;
  reason?: string;
  bookingId?: number | null;
};

export type InventoryDocumentRow = {
  id:number;
  organizationId:number;
  documentType:InventoryDocumentType;
  number:string;
  occurredAt:string;
  state:DocumentState;
  comment:string;
  createdBy:string;
  createdAt:string;
  postedBy:string;
  postedAt:string;
};

export type InventoryDocumentLineRow = {
  id:number;
  organizationId:number;
  documentId:number;
  lineNo:number;
  itemId:number;
  lotId:number|null;
  lotNumber:string;
  expiresOn:string;
  supplier:string;
  supplierCounterpartyId:number|null;
  quantity:number;
  reason:string;
  bookingId:number|null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function text(value:unknown,max:number) {
  return String(value ?? "").trim().slice(0,max);
}

function quantity(value:unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function intOrNull(value:unknown) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function prefix(type:InventoryDocumentType) {
  return type === "inventory_receipt" ? "НД" : "СП";
}

export function isInventoryDocumentType(value:unknown): value is InventoryDocumentType {
  return value === "inventory_receipt" || value === "inventory_writeoff";
}

async function item(db:D1Database,organizationId:number,itemId:number) {
  return db.prepare(
    "SELECT id,name,unit,active FROM inventory_items WHERE organization_id=? AND id=? LIMIT 1"
  ).bind(organizationId,itemId).first<{id:number;name:string;unit:string;active:number}>();
}

async function lot(db:D1Database,organizationId:number,lotId:number) {
  return db.prepare(
    `SELECT l.id,l.item_id AS itemId,l.lot_number AS lotNumber,l.expires_on AS expiresOn,l.supplier,
            l.supplier_counterparty_id AS supplierCounterpartyId,i.name,i.unit,i.active
     FROM inventory_lots l
     JOIN inventory_items i ON i.id=l.item_id AND i.organization_id=l.organization_id
     WHERE l.organization_id=? AND l.id=? LIMIT 1`
  ).bind(organizationId,lotId).first<{
    id:number;itemId:number;lotNumber:string;expiresOn:string;supplier:string;supplierCounterpartyId:number|null;
    name:string;unit:string;active:number;
  }>();
}

async function bookingExists(db:D1Database,organizationId:number,bookingId:number|null) {
  if (!bookingId) return true;
  return !!(await db.prepare(
    "SELECT 1 AS ok FROM bookings WHERE organization_id=? AND id=? LIMIT 1"
  ).bind(organizationId,bookingId).first<{ok:number}>());
}

export async function getInventoryDocument(db:D1Database,organizationId:number,documentId:number) {
  const document = await db.prepare(
    `SELECT id,organization_id AS organizationId,document_type AS documentType,number,
            occurred_at AS occurredAt,state,comment,created_by AS createdBy,created_at AS createdAt,
            posted_by AS postedBy,posted_at AS postedAt
     FROM business_documents
     WHERE organization_id=? AND id=?
       AND document_type IN ('inventory_receipt','inventory_writeoff')
     LIMIT 1`
  ).bind(organizationId,documentId).first<InventoryDocumentRow>();
  if (!document) return null;
  const lines = await db.prepare(
    `SELECT id,organization_id AS organizationId,document_id AS documentId,line_no AS lineNo,
            item_id AS itemId,lot_id AS lotId,lot_number AS lotNumber,expires_on AS expiresOn,
            supplier,supplier_counterparty_id AS supplierCounterpartyId,quantity,reason,booking_id AS bookingId
     FROM inventory_document_lines
     WHERE organization_id=? AND document_id=? ORDER BY line_no,id`
  ).bind(organizationId,documentId).all<InventoryDocumentLineRow>();
  return { document, lines:lines.results };
}

export async function listInventoryDocuments(db:D1Database,organizationId:number,limit=150) {
  const safeLimit = Math.max(1,Math.min(300,Math.trunc(limit)));
  const rows = await db.prepare(
    `SELECT d.id,d.organization_id AS organizationId,d.document_type AS documentType,d.number,
            d.occurred_at AS occurredAt,d.state,d.comment,d.created_by AS createdBy,
            d.created_at AS createdAt,d.posted_by AS postedBy,d.posted_at AS postedAt,
            COUNT(l.id) AS lineCount,COALESCE(SUM(l.quantity),0) AS totalQuantity
     FROM business_documents d
     LEFT JOIN inventory_document_lines l
       ON l.organization_id=d.organization_id AND l.document_id=d.id
     WHERE d.organization_id=? AND d.document_type IN ('inventory_receipt','inventory_writeoff')
     GROUP BY d.id
     ORDER BY d.occurred_at DESC,d.id DESC LIMIT ${safeLimit}`
  ).bind(organizationId).all<InventoryDocumentRow & {lineCount:number;totalQuantity:number}>();
  return rows.results;
}

export async function createInventoryDocument(
  db:D1Database,
  input:{organizationId:number;actorEmail:string;type:InventoryDocumentType;occurredAt?:string;comment?:string;lines:InventoryDocumentLineInput[]},
) {
  const occurredAt = text(input.occurredAt,32) || new Date().toISOString();
  const comment = text(input.comment,500);
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 100) {
    throw new Error("inventory_document_lines_required");
  }

  const normalized:Array<Required<Pick<InventoryDocumentLineInput,"quantity">> & {
    itemId:number;lotId:number|null;lotNumber:string;expiresOn:string;supplier:string;supplierCounterpartyId:number|null;
    reason:string;bookingId:number|null;
  }> = [];

  for (const source of input.lines) {
    const qty = quantity(source.quantity);
    if (!qty) throw new Error("inventory_document_invalid_quantity");
    if (input.type === "inventory_receipt") {
      const itemId = intOrNull(source.itemId);
      if (!itemId) throw new Error("inventory_document_item_required");
      const found = await item(db,input.organizationId,itemId);
      if (!found || !found.active) throw new Error("inventory_document_item_not_found");
      const expiresOn = text(source.expiresOn,10);
      if (expiresOn && !DATE_RE.test(expiresOn)) throw new Error("inventory_document_invalid_expiry");
      const supplierCounterpartyId=intOrNull(source.supplierCounterpartyId);
      let supplier=text(source.supplier,180);
      if (supplierCounterpartyId) {
        const counterparty=await getActiveSupplierCounterparty(db,input.organizationId,supplierCounterpartyId);
        if (!counterparty) throw new Error("inventory_document_supplier_not_found");
        supplier=counterparty.name;
      }
      normalized.push({
        itemId,lotId:null,quantity:qty,lotNumber:text(source.lotNumber,100),expiresOn,supplier,supplierCounterpartyId,
        reason:text(source.reason,500) || "Надходження",bookingId:null,
      });
    } else {
      const lotId = intOrNull(source.lotId);
      if (!lotId) throw new Error("inventory_document_lot_required");
      const found = await lot(db,input.organizationId,lotId);
      if (!found || !found.active) throw new Error("inventory_document_lot_not_found");
      const bookingId = intOrNull(source.bookingId);
      if (!(await bookingExists(db,input.organizationId,bookingId))) throw new Error("inventory_document_booking_not_found");
      const reason = text(source.reason,500);
      if (!reason) throw new Error("inventory_document_reason_required");
      normalized.push({
        itemId:found.itemId,lotId,quantity:qty,lotNumber:found.lotNumber,expiresOn:found.expiresOn,
        supplier:found.supplier,supplierCounterpartyId:found.supplierCounterpartyId,reason,bookingId,
      });
    }
  }

  const created = await db.prepare(
    `INSERT INTO business_documents
      (organization_id,document_type,number,occurred_at,state,comment,created_by)
     VALUES (?,?, '',?,'draft',?,?)`
  ).bind(input.organizationId,input.type,occurredAt,comment,input.actorEmail).run();
  const documentId = Number(created.meta.last_row_id || 0);
  if (!documentId) throw new Error("inventory_document_create_failed");
  const number = `${prefix(input.type)}-${String(documentId).padStart(6,"0")}`;
  await db.prepare(
    "UPDATE business_documents SET number=? WHERE organization_id=? AND id=? AND state='draft'"
  ).bind(number,input.organizationId,documentId).run();

  try {
    await db.batch(normalized.map((line,index)=>db.prepare(
      `INSERT INTO inventory_document_lines
        (organization_id,document_id,line_no,item_id,lot_id,lot_number,expires_on,supplier,supplier_counterparty_id,quantity,reason,booking_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      input.organizationId,documentId,index+1,line.itemId,line.lotId,line.lotNumber,line.expiresOn,
      line.supplier,line.supplierCounterpartyId,line.quantity,line.reason,line.bookingId,
    )));
  } catch (error) {
    await db.prepare("DELETE FROM business_documents WHERE organization_id=? AND id=? AND state='draft'")
      .bind(input.organizationId,documentId).run().catch(()=>{});
    throw error;
  }

  return getInventoryDocument(db,input.organizationId,documentId);
}

export async function cancelInventoryDocument(db:D1Database,organizationId:number,documentId:number) {
  const result = await db.prepare(
    `UPDATE business_documents SET state='cancelled'
     WHERE organization_id=? AND id=? AND state='draft'
       AND document_type IN ('inventory_receipt','inventory_writeoff')`
  ).bind(organizationId,documentId).run();
  return Number(result.meta.changes || 0) === 1;
}

export async function updateInventoryDocumentDraft(
  db:D1Database,
  input:{organizationId:number;documentId:number;occurredAt?:string;comment?:string},
) {
  const current = await getInventoryDocument(db,input.organizationId,input.documentId);
  if (!current) return { ok:false as const,reason:"not_found" as const };
  if (current.document.state !== "draft") return { ok:false as const,reason:"not_draft" as const };
  const occurredAt = input.occurredAt === undefined ? current.document.occurredAt : text(input.occurredAt,32);
  const comment = input.comment === undefined ? current.document.comment : text(input.comment,500);
  if (!occurredAt) return { ok:false as const,reason:"invalid" as const };
  await db.prepare(
    `UPDATE business_documents SET occurred_at=?,comment=?
     WHERE organization_id=? AND id=? AND state='draft'`
  ).bind(occurredAt,comment,input.organizationId,input.documentId).run();
  return { ok:true as const,document:await getInventoryDocument(db,input.organizationId,input.documentId) };
}

async function cleanupUnpostedReceiptLots(
  db:D1Database,
  organizationId:number,
  documentId:number,
  created:Array<{lineId:number;lotId:number}>,
) {
  if (created.length === 0) return;
  const current = await getInventoryDocument(db,organizationId,documentId).catch(()=>null);
  if (!current || current.document.state !== "draft") return;
  for (const entry of created) {
    await db.prepare(
      `UPDATE inventory_document_lines SET lot_id=NULL
       WHERE organization_id=? AND document_id=? AND id=? AND lot_id=?`
    ).bind(organizationId,documentId,entry.lineId,entry.lotId).run().catch(()=>{});
    await db.prepare(
      `DELETE FROM inventory_lots
       WHERE organization_id=? AND id=?
         AND NOT EXISTS (SELECT 1 FROM inventory_movements WHERE organization_id=? AND lot_id=?)
         AND NOT EXISTS (SELECT 1 FROM inventory_document_lines WHERE organization_id=? AND lot_id=?)`
    ).bind(organizationId,entry.lotId,organizationId,entry.lotId,organizationId,entry.lotId).run().catch(()=>{});
  }
}

export async function postInventoryDocument(
  db:D1Database,
  input:{organizationId:number;documentId:number;actorEmail:string},
) {
  const current = await getInventoryDocument(db,input.organizationId,input.documentId);
  if (!current) return { ok:false as const,status:404,error:"Документ не знайдено" };
  if (current.document.state === "posted") return { ok:true as const,idempotent:true,document:current };
  if (current.document.state !== "draft") return { ok:false as const,status:409,error:"Провести можна лише чернетку" };
  if (current.lines.length < 1) return { ok:false as const,status:409,error:"У документі немає рядків" };

  if (current.document.documentType === "inventory_writeoff") {
    const requiredByLot = new Map<number,number>();
    for (const line of current.lines) {
      if (!line.lotId) return { ok:false as const,status:409,error:"У списанні не вказана партія" };
      requiredByLot.set(line.lotId,(requiredByLot.get(line.lotId) || 0) + Number(line.quantity));
    }
    for (const [lotId,required] of requiredByLot) {
      const balance = await db.prepare(
        `SELECT COALESCE(SUM(quantity_delta),0) AS stock
         FROM inventory_movements WHERE organization_id=? AND lot_id=?`
      ).bind(input.organizationId,lotId).first<{stock:number}>();
      if (Number(balance?.stock || 0) + 0.000001 < required) {
        return { ok:false as const,status:409,error:"Недостатній залишок у партії для проведення документа" };
      }
    }
  }

  const lines = [...current.lines];
  const createdReceiptLots:Array<{lineId:number;lotId:number}> = [];
  if (current.document.documentType === "inventory_receipt") {
    for (const line of lines) {
      if (line.lotId) continue;
      const lotResult = await db.prepare(
        `INSERT INTO inventory_lots (organization_id,item_id,lot_number,expires_on,supplier,supplier_counterparty_id)
         VALUES (?,?,?,?,?,?)`
      ).bind(input.organizationId,line.itemId,line.lotNumber,line.expiresOn,line.supplier,line.supplierCounterpartyId).run();
      const lotId = Number(lotResult.meta.last_row_id || 0);
      if (!lotId) {
        await cleanupUnpostedReceiptLots(db,input.organizationId,input.documentId,createdReceiptLots);
        throw new Error("inventory_lot_create_failed");
      }
      await db.prepare(
        `UPDATE inventory_document_lines SET lot_id=?
         WHERE organization_id=? AND document_id=? AND id=?`
      ).bind(lotId,input.organizationId,input.documentId,line.id).run();
      line.lotId = lotId;
      createdReceiptLots.push({lineId:line.id,lotId});
    }
  }

  const postedAt = new Date().toISOString();
  const statements = [
    db.prepare(
      `UPDATE business_documents SET state='posted',posted_by=?,posted_at=?
       WHERE organization_id=? AND id=? AND state='draft'`
    ).bind(input.actorEmail,postedAt,input.organizationId,input.documentId),
    ...lines.map((line)=>db.prepare(
      `INSERT INTO inventory_movements
        (organization_id,item_id,lot_id,movement_type,quantity_delta,reason,booking_id,actor_email,document_id,document_line_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      input.organizationId,line.itemId,line.lotId,
      current.document.documentType === "inventory_receipt" ? "receipt" : "writeoff",
      current.document.documentType === "inventory_receipt" ? Number(line.quantity) : -Number(line.quantity),
      line.reason,line.bookingId,input.actorEmail,input.documentId,line.id,
    )),
  ];

  try {
    await db.batch(statements);
  } catch (error) {
    const message = String(error).toLowerCase();
    if (message.includes("unique")) {
      const again = await getInventoryDocument(db,input.organizationId,input.documentId);
      if (again?.document.state === "posted") return { ok:true as const,idempotent:true,document:again };
    }
    await cleanupUnpostedReceiptLots(db,input.organizationId,input.documentId,createdReceiptLots);
    if (message.includes("inventory_negative_stock")) {
      return { ok:false as const,status:409,error:"Недостатній залишок у партії для проведення документа" };
    }
    throw error;
  }

  return { ok:true as const,idempotent:false,document:await getInventoryDocument(db,input.organizationId,input.documentId) };
}
