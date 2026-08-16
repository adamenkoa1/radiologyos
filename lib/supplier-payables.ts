import { getCashAccount } from "./cash-accounts";
import { getCounterparty } from "./counterparties";

export type SupplierPaymentAllocationInput = { receiptDocumentId:number; amount:number };
export type ReceiptValuationInput = { lineId:number; unitCost:number };

function int(value:unknown) {
  const n=Number(value);
  return Number.isInteger(n)&&n>0?n:null;
}
function money(value:unknown,allowZero=false) {
  const n=Number(value);
  return Number.isInteger(n)&&(allowZero?n>=0:n>0)?n:null;
}
function text(value:unknown,max:number) { return String(value??"").trim().slice(0,max); }

export async function valueInventoryReceipt(
  db:D1Database,
  input:{organizationId:number;documentId:number;lines:ReceiptValuationInput[]},
) {
  const doc=await db.prepare(
    `SELECT id,state FROM business_documents
     WHERE organization_id=? AND id=? AND document_type='inventory_receipt' LIMIT 1`
  ).bind(input.organizationId,input.documentId).first<{id:number;state:string}>();
  if(!doc)return {ok:false as const,status:404,error:"Надходження не знайдено"};
  if(doc.state!=="draft")return {ok:false as const,status:409,error:"Вартість можна змінювати лише у чернетці надходження"};
  if(!Array.isArray(input.lines)||input.lines.length<1||input.lines.length>100){
    return {ok:false as const,status:400,error:"Додайте оцінку хоча б одного рядка"};
  }
  const seen=new Set<number>();
  const statements:D1PreparedStatement[]=[];
  for(const source of input.lines){
    const lineId=int(source.lineId);const unitCost=money(source.unitCost,true);
    if(!lineId||unitCost===null||seen.has(lineId))return {ok:false as const,status:400,error:"Некоректна оцінка рядка"};
    seen.add(lineId);
    const line=await db.prepare(
      `SELECT id,quantity,supplier_counterparty_id AS supplierCounterpartyId
       FROM inventory_document_lines
       WHERE organization_id=? AND document_id=? AND id=? LIMIT 1`
    ).bind(input.organizationId,input.documentId,lineId).first<{id:number;quantity:number;supplierCounterpartyId:number|null}>();
    if(!line)return {ok:false as const,status:404,error:"Рядок надходження не знайдено"};
    if(unitCost>0&&!line.supplierCounterpartyId){
      return {ok:false as const,status:409,error:"Для закупівельної вартості виберіть постачальника у рядку надходження"};
    }
    if(line.supplierCounterpartyId&&unitCost<=0){
      return {ok:false as const,status:409,error:"Для рядка з постачальником вкажіть закупівельну вартість"};
    }
    const lineAmount=Math.round(Number(line.quantity)*unitCost);
    if(line.supplierCounterpartyId&&lineAmount<=0){
      return {ok:false as const,status:409,error:"Сума закупівельного рядка має бути більшою за нуль"};
    }
    statements.push(db.prepare(
      `UPDATE inventory_document_lines SET unit_cost=?,line_amount=?
       WHERE organization_id=? AND document_id=? AND id=?`
    ).bind(unitCost,lineAmount,input.organizationId,input.documentId,lineId));
  }
  await db.batch(statements);
  return {ok:true as const};
}

export async function listSupplierPayables(db:D1Database,organizationId:number,input:{supplierId?:number;openOnly?:boolean}={}) {
  const where=["b.organization_id=?"];const args:Array<number|string>=[organizationId];
  if(input.supplierId){where.push("b.supplier_counterparty_id=?");args.push(input.supplierId);}
  if(input.openOnly!==false)where.push("b.balance>0");
  const rows=await db.prepare(
    `SELECT b.supplier_counterparty_id AS supplierId,b.supplier_name AS supplierName,
            b.receipt_document_id AS receiptDocumentId,b.currency,b.balance,
            d.number AS receiptNumber,d.occurred_at AS receiptOccurredAt
     FROM supplier_payable_balance b
     JOIN business_documents d ON d.id=b.receipt_document_id AND d.organization_id=b.organization_id
     WHERE ${where.join(" AND ")}
     ORDER BY d.occurred_at,d.id`
  ).bind(...args).all();
  return rows.results;
}

export async function listCashAccountBalances(db:D1Database,organizationId:number) {
  const rows=await db.prepare(
    `SELECT a.id AS cashAccountId,a.code,a.name,a.account_type AS accountType,a.currency,
            COALESCE(b.balance,0) AS balance,a.active,a.is_default AS isDefault
     FROM cash_accounts a
     LEFT JOIN cash_account_balance b
       ON b.organization_id=a.organization_id AND b.cash_account_id=a.id AND b.currency=a.currency
     WHERE a.organization_id=? ORDER BY a.active DESC,a.is_default DESC,a.name,a.id`
  ).bind(organizationId).all();
  return rows.results;
}

export async function getSupplierPayment(db:D1Database,organizationId:number,id:number) {
  const document=await db.prepare(
    `SELECT id,organization_id AS organizationId,number,
            supplier_counterparty_id AS supplierId,supplier_code AS supplierCode,supplier_name AS supplierName,
            cash_account_id AS cashAccountId,cash_account_code AS cashAccountCode,cash_account_name AS cashAccountName,
            currency,amount,occurred_at AS occurredAt,state,comment,created_by AS createdBy,created_at AS createdAt,
            posted_by AS postedBy,posted_at AS postedAt
     FROM supplier_payment_documents WHERE organization_id=? AND id=? LIMIT 1`
  ).bind(organizationId,id).first();
  if(!document)return null;
  const allocations=await db.prepare(
    `SELECT a.id,a.receipt_document_id AS receiptDocumentId,a.amount,d.number AS receiptNumber,d.occurred_at AS receiptOccurredAt
     FROM supplier_payment_allocations a
     JOIN business_documents d ON d.id=a.receipt_document_id AND d.organization_id=a.organization_id
     WHERE a.organization_id=? AND a.payment_document_id=? ORDER BY a.id`
  ).bind(organizationId,id).all();
  return {document,allocations:allocations.results};
}

export async function listSupplierPayments(db:D1Database,organizationId:number,limit=200) {
  const safe=Math.max(1,Math.min(300,Math.trunc(limit)));
  const rows=await db.prepare(
    `SELECT p.id,p.number,p.supplier_counterparty_id AS supplierId,p.supplier_name AS supplierName,
            p.cash_account_id AS cashAccountId,p.cash_account_name AS cashAccountName,p.currency,p.amount,
            p.occurred_at AS occurredAt,p.state,p.comment,p.created_by AS createdBy,p.posted_by AS postedBy,p.posted_at AS postedAt,
            COUNT(a.id) AS allocationCount
     FROM supplier_payment_documents p
     LEFT JOIN supplier_payment_allocations a ON a.organization_id=p.organization_id AND a.payment_document_id=p.id
     WHERE p.organization_id=? GROUP BY p.id ORDER BY p.occurred_at DESC,p.id DESC LIMIT ${safe}`
  ).bind(organizationId).all();
  return rows.results;
}

export async function createSupplierPayment(
  db:D1Database,
  input:{organizationId:number;actorEmail:string;supplierId:number;cashAccountId:number;allocations:SupplierPaymentAllocationInput[];occurredAt?:string;comment?:string},
) {
  const supplierId=int(input.supplierId);const cashAccountId=int(input.cashAccountId);
  if(!supplierId||!cashAccountId)throw new Error("supplier_payment_reference_required");
  const supplier=await getCounterparty(db,input.organizationId,supplierId);
  if(!supplier||!(supplier.kind==="supplier"||supplier.kind==="both"))throw new Error("supplier_payment_supplier_not_found");
  const account=await getCashAccount(db,input.organizationId,cashAccountId);
  if(!account||!account.active||account.currency!=="UAH")throw new Error("supplier_payment_cash_account_not_found");
  if(!Array.isArray(input.allocations)||input.allocations.length<1||input.allocations.length>100)throw new Error("supplier_payment_allocations_required");

  const seen=new Set<number>();const normalized:SupplierPaymentAllocationInput[]=[];let total=0;
  for(const source of input.allocations){
    const receiptDocumentId=int(source.receiptDocumentId);const amount=money(source.amount);
    if(!receiptDocumentId||!amount||seen.has(receiptDocumentId))throw new Error("supplier_payment_allocation_invalid");
    seen.add(receiptDocumentId);
    const balance=await db.prepare(
      `SELECT balance FROM supplier_payable_balance
       WHERE organization_id=? AND supplier_counterparty_id=? AND receipt_document_id=? AND currency='UAH' LIMIT 1`
    ).bind(input.organizationId,supplierId,receiptDocumentId).first<{balance:number}>();
    if(!balance||Number(balance.balance)<=0)throw new Error("supplier_payment_receipt_not_payable");
    if(amount>Number(balance.balance))throw new Error("supplier_payment_overpay");
    normalized.push({receiptDocumentId,amount});total+=amount;
  }
  const occurredAt=text(input.occurredAt,32)||new Date().toISOString();const comment=text(input.comment,500);
  const created=await db.prepare(
    `INSERT INTO supplier_payment_documents
      (organization_id,number,supplier_counterparty_id,supplier_code,supplier_name,
       cash_account_id,cash_account_code,cash_account_name,currency,amount,occurred_at,state,comment,created_by)
     VALUES (?,'',?,?,?,?,?,?, 'UAH',?,?,'draft',?,?)`
  ).bind(
    input.organizationId,supplier.id,supplier.code,supplier.name,
    account.id,account.code,account.name,total,occurredAt,comment,input.actorEmail,
  ).run();
  const id=Number(created.meta.last_row_id||0);if(!id)throw new Error("supplier_payment_create_failed");
  const number=`ОП-${String(id).padStart(6,"0")}`;
  try{
    await db.prepare("UPDATE supplier_payment_documents SET number=? WHERE organization_id=? AND id=? AND state='draft'")
      .bind(number,input.organizationId,id).run();
    await db.batch(normalized.map(a=>db.prepare(
      `INSERT INTO supplier_payment_allocations (organization_id,payment_document_id,receipt_document_id,amount)
       VALUES (?,?,?,?)`
    ).bind(input.organizationId,id,a.receiptDocumentId,a.amount)));
  }catch(error){
    await db.prepare("DELETE FROM supplier_payment_allocations WHERE organization_id=? AND payment_document_id=?").bind(input.organizationId,id).run().catch(()=>{});
    await db.prepare("DELETE FROM supplier_payment_documents WHERE organization_id=? AND id=? AND state='draft'").bind(input.organizationId,id).run().catch(()=>{});
    throw error;
  }
  return getSupplierPayment(db,input.organizationId,id);
}

export async function postSupplierPayment(db:D1Database,input:{organizationId:number;documentId:number;actorEmail:string}) {
  const current=await getSupplierPayment(db,input.organizationId,input.documentId);
  if(!current)return {ok:false as const,status:404,error:"Оплату постачальнику не знайдено"};
  const state=String((current.document as {state:string}).state);
  if(state==="posted")return {ok:true as const,idempotent:true,document:current};
  if(state!=="draft")return {ok:false as const,status:409,error:"Провести можна лише чернетку оплати"};
  const postedAt=new Date().toISOString();
  try{
    await db.prepare(
      `UPDATE supplier_payment_documents SET state='posted',posted_by=?,posted_at=?
       WHERE organization_id=? AND id=? AND state='draft'`
    ).bind(input.actorEmail,postedAt,input.organizationId,input.documentId).run();
  }catch(error){
    const code=String(error instanceof Error?error.message:error);
    if(code.includes("allocation_total_mismatch"))return {ok:false as const,status:409,error:"Розподіл оплати не дорівнює сумі документа"};
    if(code.includes("overpay"))return {ok:false as const,status:409,error:"Оплата перевищує актуальний борг за одним із надходжень"};
    if(code.includes("cash_account_inactive"))return {ok:false as const,status:409,error:"Рахунок/каса вже неактивні — виберіть активний рахунок"};
    throw error;
  }
  return {ok:true as const,idempotent:false,document:await getSupplierPayment(db,input.organizationId,input.documentId)};
}

export async function cancelSupplierPayment(db:D1Database,organizationId:number,documentId:number) {
  const result=await db.prepare(
    "UPDATE supplier_payment_documents SET state='cancelled' WHERE organization_id=? AND id=? AND state='draft'"
  ).bind(organizationId,documentId).run();
  return Number(result.meta.changes||0)===1;
}
