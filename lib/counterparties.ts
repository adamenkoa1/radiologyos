export type CounterpartyKind="supplier"|"payer"|"both"|"other";

export type CounterpartyRow={
  id:number;organizationId:number;code:string;name:string;kind:CounterpartyKind;
  taxId:string;phone:string;email:string;address:string;active:number;createdAt:string;updatedAt:string;
};

const KINDS=new Set<CounterpartyKind>(["supplier","payer","both","other"]);

function text(value:unknown,max:number){return String(value??"").trim().slice(0,max);}
function bool(value:unknown){return value===false||value===0||value==="0"?0:1;}
export function isCounterpartyKind(value:unknown):value is CounterpartyKind{return KINDS.has(String(value) as CounterpartyKind);}

const SELECT=`SELECT id,organization_id AS organizationId,code,name,kind,tax_id AS taxId,phone,email,address,
                     active,created_at AS createdAt,updated_at AS updatedAt FROM counterparties`;

export async function getCounterparty(db:D1Database,organizationId:number,id:number){
  return db.prepare(`${SELECT} WHERE organization_id=? AND id=? LIMIT 1`)
    .bind(organizationId,id).first<CounterpartyRow>();
}

export async function listCounterparties(
  db:D1Database,
  organizationId:number,
  input:{kind?:CounterpartyKind|"supplier_or_both";active?:boolean;query?:string;limit?:number}={},
){
  const where=["organization_id=?"];const args:Array<string|number>=[organizationId];
  if(input.kind==="supplier_or_both") where.push("kind IN ('supplier','both')");
  else if(input.kind){where.push("kind=?");args.push(input.kind);}
  if(input.active!==undefined){where.push("active=?");args.push(input.active?1:0);}
  const q=text(input.query,100).toLowerCase();
  if(q){where.push("(lower(name) LIKE ? OR lower(code) LIKE ? OR lower(tax_id) LIKE ?)");const like=`%${q}%`;args.push(like,like,like);}
  const limit=Math.max(1,Math.min(500,Math.trunc(input.limit||250)));
  const rows=await db.prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY active DESC,name,id LIMIT ${limit}`)
    .bind(...args).all<CounterpartyRow>();
  return rows.results;
}

export function normalizeCounterpartyInput(input:Record<string,unknown>){
  const name=text(input.name,180);
  const code=text(input.code,80);
  const kind=isCounterpartyKind(input.kind)?input.kind:"supplier";
  const taxId=text(input.taxId,40);
  const phone=text(input.phone,40);
  const email=text(input.email,160).toLowerCase();
  const address=text(input.address,300);
  const active=input.active===undefined?1:bool(input.active);
  if(!name) throw new Error("counterparty_name_required");
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("counterparty_email_invalid");
  return {name,code,kind,taxId,phone,email,address,active};
}

export async function createCounterparty(db:D1Database,input:{organizationId:number;values:Record<string,unknown>}){
  const value=normalizeCounterpartyInput(input.values);
  const result=await db.prepare(
    `INSERT INTO counterparties (organization_id,code,name,kind,tax_id,phone,email,address,active)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(input.organizationId,value.code,value.name,value.kind,value.taxId,value.phone,value.email,value.address,value.active).run();
  const id=Number(result.meta.last_row_id||0);
  if(!id) throw new Error("counterparty_create_failed");
  return getCounterparty(db,input.organizationId,id);
}

export async function updateCounterparty(db:D1Database,input:{organizationId:number;id:number;values:Record<string,unknown>}){
  const current=await getCounterparty(db,input.organizationId,input.id);
  if(!current)return null;
  const value=normalizeCounterpartyInput({
    name:input.values.name===undefined?current.name:input.values.name,
    code:input.values.code===undefined?current.code:input.values.code,
    kind:input.values.kind===undefined?current.kind:input.values.kind,
    taxId:input.values.taxId===undefined?current.taxId:input.values.taxId,
    phone:input.values.phone===undefined?current.phone:input.values.phone,
    email:input.values.email===undefined?current.email:input.values.email,
    address:input.values.address===undefined?current.address:input.values.address,
    active:input.values.active===undefined?!!current.active:input.values.active,
  });
  await db.prepare(
    `UPDATE counterparties SET code=?,name=?,kind=?,tax_id=?,phone=?,email=?,address=?,active=?,updated_at=CURRENT_TIMESTAMP
     WHERE organization_id=? AND id=?`
  ).bind(value.code,value.name,value.kind,value.taxId,value.phone,value.email,value.address,value.active,input.organizationId,input.id).run();
  return getCounterparty(db,input.organizationId,input.id);
}

export async function getActiveSupplierCounterparty(db:D1Database,organizationId:number,id:number){
  return db.prepare(
    `${SELECT} WHERE organization_id=? AND id=? AND active=1 AND kind IN ('supplier','both') LIMIT 1`
  ).bind(organizationId,id).first<CounterpartyRow>();
}
