import { listCashAccounts } from "../../../../lib/cash-accounts";
import { dbBinding } from "../../../../lib/db";
import { listCashMovements,listFinanceDocuments,listPatientSettlementBalances,summarizeCashRegister } from "../../../../lib/finance-documents";
import { canManageFinance } from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";

function periodDate(value:string|null){const result=String(value??"").trim();return /^\d{4}-\d{2}-\d{2}$/.test(result)?result:"";}

export async function GET(request:Request){
  const db=dbBinding();if(!db)return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);if(!ctx)return Response.json({error:"Доступ лише для персоналу"},{status:403});
  if(!canManageFinance(ctx.member.role))return Response.json({error:"Фінансовий журнал доступний реєстратору або адміністратору"},{status:403});
  const url=new URL(request.url);
  const period={from:periodDate(url.searchParams.get("from")),to:periodDate(url.searchParams.get("to"))};
  const [documents,cashMovements,settlements,cashAccounts,summary,legacy]=await Promise.all([
    listFinanceDocuments(db,ctx.organizationId,period),listCashMovements(db,ctx.organizationId,period),
    listPatientSettlementBalances(db,ctx.organizationId,period),
    listCashAccounts(db,ctx.organizationId),summarizeCashRegister(db,ctx.organizationId,period),
    db.prepare(`SELECT COUNT(*) AS count FROM payment_transactions WHERE organization_id=? AND status IN ('paid','refunded') AND payment_document_id IS NULL AND refund_document_id IS NULL`)
      .bind(ctx.organizationId).first<{count:number}>(),
  ]);
  return Response.json({documents,cashMovements,settlements,cashAccounts,summary,period,legacyTransactionCount:Number(legacy?.count||0),canManage:true});
}
