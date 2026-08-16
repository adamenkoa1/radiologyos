import { audit } from "../../../../lib/audit";
import { dbBinding } from "../../../../lib/db";
import { canManageFinance } from "../../../../lib/staff-auth";
import {
  cancelSupplierPayment,
  createSupplierPayment,
  getSupplierPayment,
  listCashAccountBalances,
  listSupplierPayables,
  listSupplierPayments,
  postSupplierPayment,
  valueInventoryReceipt,
  type ReceiptValuationInput,
  type SupplierPaymentAllocationInput,
} from "../../../../lib/supplier-payables";
import { requireOrgContext } from "../../../../lib/tenant";

function int(value:unknown) {
  const n=Number(value);
  return Number.isInteger(n)&&n>0?n:null;
}
function clean(value:unknown,max:number) { return String(value??"").trim().slice(0,max); }

function mapCreateError(error:unknown) {
  const code=String(error instanceof Error?error.message:error);
  if(code.includes("reference_required"))return [400,"Вкажіть постачальника та рахунок/касу"] as const;
  if(code.includes("supplier_not_found"))return [404,"Постачальника не знайдено"] as const;
  if(code.includes("cash_account_not_found"))return [404,"Активний рахунок/касу не знайдено"] as const;
  if(code.includes("allocations_required"))return [400,"Розподіліть оплату хоча б на одне надходження"] as const;
  if(code.includes("allocation_invalid"))return [400,"Некоректний розподіл оплати"] as const;
  if(code.includes("receipt_not_payable"))return [409,"За вибраним надходженням немає відкритого боргу цього постачальника"] as const;
  if(code.includes("overpay"))return [409,"Оплата перевищує актуальний борг"] as const;
  return null;
}

async function context(request:Request,db:D1Database) {
  const ctx=await requireOrgContext(request,db);
  if(!ctx)return {response:Response.json({error:"Доступ лише для персоналу"},{status:403})} as const;
  if(!canManageFinance(ctx.role))return {response:Response.json({error:"Кредиторку та оплати постачальникам можуть вести реєстратор або адміністратор"},{status:403})} as const;
  return {ctx} as const;
}

export async function GET(request:Request) {
  const db=dbBinding();
  if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const access=await context(request,db);if("response" in access)return access.response;
  const {ctx}=access;
  const url=new URL(request.url);const id=int(url.searchParams.get("id"));
  if(id){
    const payment=await getSupplierPayment(db,ctx.organizationId,id);
    if(!payment)return Response.json({error:"Оплату постачальнику не знайдено"},{status:404});
    return Response.json({payment,staff:ctx.member,canManage:true});
  }
  const supplierId=int(url.searchParams.get("supplierId"))||undefined;
  const [payables,payments,cashBalances]=await Promise.all([
    listSupplierPayables(db,ctx.organizationId,{supplierId,openOnly:url.searchParams.get("all")!=="1"}),
    listSupplierPayments(db,ctx.organizationId),
    listCashAccountBalances(db,ctx.organizationId),
  ]);
  return Response.json({payables,payments,cashBalances,staff:ctx.member,canManage:true});
}

export async function POST(request:Request) {
  const db=dbBinding();
  if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const access=await context(request,db);if("response" in access)return access.response;
  const {ctx}=access;
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  const action=clean(body.action,40);

  if(action==="value_receipt"){
    const documentId=int(body.documentId);
    const lines=Array.isArray(body.lines)?body.lines as ReceiptValuationInput[]:[];
    if(!documentId)return Response.json({error:"Некоректне надходження"},{status:400});
    const result=await valueInventoryReceipt(db,{organizationId:ctx.organizationId,documentId,lines});
    if(!result.ok)return Response.json({error:result.error},{status:result.status});
    await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"inventory_receipt_valued",resource:"business_document",targetId:documentId,details:{lineCount:lines.length}});
    return Response.json({ok:true});
  }

  if(action==="create_payment"){
    const supplierId=int(body.supplierId);const cashAccountId=int(body.cashAccountId);
    const allocations=Array.isArray(body.allocations)?body.allocations as SupplierPaymentAllocationInput[]:[];
    if(!supplierId||!cashAccountId)return Response.json({error:"Вкажіть постачальника та рахунок/касу"},{status:400});
    try{
      const created=await createSupplierPayment(db,{
        organizationId:ctx.organizationId,actorEmail:ctx.member.email,supplierId,cashAccountId,allocations,
        occurredAt:clean(body.occurredAt,32)||undefined,comment:clean(body.comment,500),
      });
      if(!created)return Response.json({error:"Не вдалося створити оплату"},{status:500});
      await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"supplier_payment_created",resource:"supplier_payment",targetId:Number((created.document as {id:number}).id),details:{supplierId,allocationCount:allocations.length}});
      return Response.json(created,{status:201});
    }catch(error){
      const mapped=mapCreateError(error);if(mapped)return Response.json({error:mapped[1]},{status:mapped[0]});
      throw error;
    }
  }

  const documentId=int(body.documentId);
  if(!documentId)return Response.json({error:"Некоректний документ"},{status:400});
  if(action==="post_payment"){
    const result=await postSupplierPayment(db,{organizationId:ctx.organizationId,documentId,actorEmail:ctx.member.email});
    if(!result.ok)return Response.json({error:result.error},{status:result.status});
    await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:result.idempotent?"supplier_payment_post_replayed":"supplier_payment_posted",resource:"supplier_payment",targetId:documentId,details:{idempotent:result.idempotent}});
    return Response.json(result.document);
  }
  if(action==="cancel_payment"){
    const ok=await cancelSupplierPayment(db,ctx.organizationId,documentId);
    if(!ok){
      const current=await getSupplierPayment(db,ctx.organizationId,documentId);
      if(!current)return Response.json({error:"Оплату постачальнику не знайдено"},{status:404});
      return Response.json({error:"Скасувати можна лише чернетку оплати"},{status:409});
    }
    await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"supplier_payment_cancelled",resource:"supplier_payment",targetId:documentId});
    return Response.json({ok:true});
  }
  return Response.json({error:"Невідома дія"},{status:400});
}
