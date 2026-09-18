import { audit } from "../../../../lib/audit";
import { createCashAccount,isCashAccountType,listCashAccounts,updateCashAccount } from "../../../../lib/cash-accounts";
import { dbBinding } from "../../../../lib/db";
import { canManageFinance } from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";

function id(value:unknown){const n=Number(value);return Number.isInteger(n)&&n>0?n:null;}
function clean(value:unknown,max:number){return String(value??"").trim().slice(0,max);}
function mapError(error:unknown){
  const code=String(error instanceof Error?error.message:error).toLowerCase();
  if(code.includes("cash_account_name_required"))return Response.json({error:"Вкажіть назву каси або рахунку"},{status:400});
  if(code.includes("cash_account_currency_invalid"))return Response.json({error:"Некоректна валюта рахунку"},{status:400});
  if(code.includes("cash_account_classification_immutable"))return Response.json({error:"Тип і валюту існуючої каси/рахунку не можна змінювати; створіть новий елемент довідника"},{status:409});
  if(code.includes("cash_account_default_must_be_active"))return Response.json({error:"Основний рахунок має бути активним"},{status:409});
  if(code.includes("cash_account_default_replacement_required"))return Response.json({error:"Спочатку створіть інший активний рахунок цього типу і валюти"},{status:409});
  if(code.includes("unique"))return Response.json({error:"Такий код каси/рахунку вже існує"},{status:409});
  return null;
}
async function context(request:Request){
  const db=dbBinding();if(!db)return {response:Response.json({error:"База тимчасово недоступна"},{status:503})} as const;
  const ctx=await requireOrgContext(request,db);if(!ctx||!canManageFinance(ctx.member.role))return {response:Response.json({error:"Каси і рахунки доступні реєстратору або адміністратору"},{status:403})} as const;
  return {db,ctx} as const;
}
export async function GET(request:Request){
  const auth=await context(request);if("response" in auth)return auth.response;const {db,ctx}=auth;const url=new URL(request.url);const rawType=clean(url.searchParams.get("type"),20);
  const type=isCashAccountType(rawType)?rawType:undefined;const activeParam=url.searchParams.get("active");const active=activeParam==="1"?true:activeParam==="0"?false:undefined;
  const accounts=await listCashAccounts(db,ctx.organizationId,{type,active,currency:clean(url.searchParams.get("currency"),3)||undefined});return Response.json({accounts,staff:ctx.member,canEdit:ctx.role==="admin"});
}
export async function POST(request:Request){
  const auth=await context(request);if("response" in auth)return auth.response;const {db,ctx}=auth;if(ctx.role!=="admin")return Response.json({error:"Каси і рахунки може змінювати лише адміністратор"},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;
  try{const account=await createCashAccount(db,{organizationId:ctx.organizationId,values:body});if(!account)return Response.json({error:"Не вдалося створити касу або рахунок"},{status:500});await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"cash_account_created",resource:"cash_account",targetId:account.id,details:{accountType:account.accountType,currency:account.currency,active:!!account.active,isDefault:!!account.isDefault,hasCode:!!account.code}});return Response.json({account},{status:201});}catch(error){const mapped=mapError(error);if(mapped)return mapped;throw error;}
}
export async function PATCH(request:Request){
  const auth=await context(request);if("response" in auth)return auth.response;const {db,ctx}=auth;if(ctx.role!=="admin")return Response.json({error:"Каси і рахунки може змінювати лише адміністратор"},{status:403});
  const body=await request.json().catch(()=>({})) as Record<string,unknown>;const accountId=id(body.id);if(!accountId)return Response.json({error:"Некоректна каса або рахунок"},{status:400});
  try{const account=await updateCashAccount(db,{organizationId:ctx.organizationId,id:accountId,values:body});if(!account)return Response.json({error:"Касу або рахунок не знайдено"},{status:404});await audit(db,{organizationId:ctx.organizationId,actorEmail:ctx.member.email,action:"cash_account_updated",resource:"cash_account",targetId:account.id,details:{accountType:account.accountType,currency:account.currency,active:!!account.active,isDefault:!!account.isDefault,hasCode:!!account.code}});return Response.json({account});}catch(error){const mapped=mapError(error);if(mapped)return mapped;throw error;}
}
