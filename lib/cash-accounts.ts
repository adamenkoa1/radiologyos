export type CashAccountType="cash"|"bank"|"provider"|"other";
export type CashAccountRow={id:number;organizationId:number;code:string;name:string;accountType:CashAccountType;currency:string;active:number;isDefault:number;createdAt:string;updatedAt:string};
const TYPES=new Set<CashAccountType>(["cash","bank","provider","other"]);
const SELECT=`SELECT id,organization_id AS organizationId,code,name,account_type AS accountType,currency,
                     active,is_default AS isDefault,created_at AS createdAt,updated_at AS updatedAt FROM cash_accounts`;
function text(value:unknown,max:number){return String(value??"").trim().slice(0,max);}
function flag(value:unknown){return value===false||value===0||value==="0"?0:1;}
function accountCurrency(value:unknown){const v=text(value,3).toUpperCase();if(!/^[A-Z]{3}$/.test(v))throw new Error("cash_account_currency_invalid");return v;}
export function isCashAccountType(value:unknown):value is CashAccountType{return TYPES.has(String(value) as CashAccountType);}
export async function getCashAccount(db:D1Database,organizationId:number,id:number){return db.prepare(`${SELECT} WHERE organization_id=? AND id=? LIMIT 1`).bind(organizationId,id).first<CashAccountRow>();}
export async function listCashAccounts(db:D1Database,organizationId:number,input:{active?:boolean;type?:CashAccountType;currency?:string}={}){
  const where=["organization_id=?"];const args:Array<string|number>=[organizationId];
  if(input.active!==undefined){where.push("active=?");args.push(input.active?1:0);}if(input.type){where.push("account_type=?");args.push(input.type);}if(input.currency){where.push("currency=?");args.push(accountCurrency(input.currency));}
  const rows=await db.prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY active DESC,is_default DESC,account_type,name,id`).bind(...args).all<CashAccountRow>();return rows.results;
}
export function normalizeCashAccountInput(input:Record<string,unknown>){
  const name=text(input.name,180);if(!name)throw new Error("cash_account_name_required");const code=text(input.code,80);
  const accountType=isCashAccountType(input.accountType)?input.accountType:"cash";const currency=accountCurrency(input.currency||"UAH");
  const active=input.active===undefined?1:flag(input.active);const isDefault=input.isDefault===undefined?0:flag(input.isDefault);
  if(isDefault&&!active)throw new Error("cash_account_default_must_be_active");return{name,code,accountType,currency,active,isDefault};
}
async function applyDefault(db:D1Database,organizationId:number,id:number,type:CashAccountType,currency:string){
  await db.batch([
    db.prepare(`UPDATE cash_accounts SET is_default=0,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND account_type=? AND currency=? AND id<>? AND is_default=1`).bind(organizationId,type,currency,id),
    db.prepare(`UPDATE cash_accounts SET is_default=1,active=1,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND id=?`).bind(organizationId,id),
  ]);
}
export async function createCashAccount(db:D1Database,input:{organizationId:number;values:Record<string,unknown>}){
  const v=normalizeCashAccountInput(input.values);const result=await db.prepare(`INSERT INTO cash_accounts (organization_id,code,name,account_type,currency,active,is_default) VALUES (?,?,?,?,?,?,0)`).bind(input.organizationId,v.code,v.name,v.accountType,v.currency,v.active).run();
  const id=Number(result.meta.last_row_id||0);if(!id)throw new Error("cash_account_create_failed");if(v.isDefault)await applyDefault(db,input.organizationId,id,v.accountType,v.currency);return getCashAccount(db,input.organizationId,id);
}
export async function updateCashAccount(db:D1Database,input:{organizationId:number;id:number;values:Record<string,unknown>}){
  const current=await getCashAccount(db,input.organizationId,input.id);if(!current)return null;
  const requestedType=input.values.accountType===undefined?current.accountType:(isCashAccountType(input.values.accountType)?input.values.accountType:"cash");
  const requestedCurrency=input.values.currency===undefined?current.currency:accountCurrency(input.values.currency);
  if(requestedType!==current.accountType||requestedCurrency!==current.currency)throw new Error("cash_account_classification_immutable");
  const v=normalizeCashAccountInput({name:input.values.name===undefined?current.name:input.values.name,code:input.values.code===undefined?current.code:input.values.code,accountType:current.accountType,currency:current.currency,active:input.values.active===undefined?!!current.active:input.values.active,isDefault:input.values.isDefault===undefined?!!current.isDefault:input.values.isDefault});
  if(current.isDefault&&(!v.active||!v.isDefault)){
    const replacement=await db.prepare(`SELECT id FROM cash_accounts WHERE organization_id=? AND id<>? AND active=1 AND account_type=? AND currency=? ORDER BY is_default DESC,id LIMIT 1`).bind(input.organizationId,input.id,current.accountType,current.currency).first<{id:number}>();
    if(!replacement)throw new Error("cash_account_default_replacement_required");await applyDefault(db,input.organizationId,replacement.id,current.accountType,current.currency);
  }
  await db.prepare(`UPDATE cash_accounts SET code=?,name=?,active=?,is_default=0,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND id=?`).bind(v.code,v.name,v.active,input.organizationId,input.id).run();
  if(v.isDefault)await applyDefault(db,input.organizationId,input.id,current.accountType,current.currency);return getCashAccount(db,input.organizationId,input.id);
}
function methodAccountType(method:string):CashAccountType{return method.trim().toLowerCase()==="cash"?"cash":"bank";}
export async function resolveCashAccount(db:D1Database,input:{organizationId:number;currency:string;method:string;cashAccountId?:number|null}){
  const currency=accountCurrency(input.currency||"UAH");
  if(input.cashAccountId){const row=await db.prepare(`${SELECT} WHERE organization_id=? AND id=? AND active=1 AND currency=? LIMIT 1`).bind(input.organizationId,input.cashAccountId,currency).first<CashAccountRow>();if(!row)throw new Error("cash_account_not_found");return row;}
  const type=methodAccountType(input.method);const row=await db.prepare(`${SELECT} WHERE organization_id=? AND account_type=? AND currency=? AND active=1 ORDER BY is_default DESC,id LIMIT 1`).bind(input.organizationId,type,currency).first<CashAccountRow>();if(!row)throw new Error("cash_account_not_found");return row;
}
