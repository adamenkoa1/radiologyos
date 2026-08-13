import { requireOrgContext } from "../../../../lib/tenant";
import { audit } from "../../../../lib/audit";
import { dbBinding } from "../../../../lib/db";
import { getOrgSetting, setOrgSettingCompat } from "../../../../lib/settings";
import { EQUIPMENT_REGISTRY_KEY, parseEquipmentRegistry, sanitizeEquipmentRegistry } from "../../../../lib/equipment-registry";

export async function GET(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx = await requireOrgContext(request,db);
  if (!ctx) return Response.json({error:"Доступ лише для персоналу"},{status:403});
  const equipment = parseEquipmentRegistry(await getOrgSetting(db,ctx.organizationId,EQUIPMENT_REGISTRY_KEY));
  return Response.json({equipment,staff:{...ctx.member,role:ctx.role}},{headers:{"cache-control":"no-store"}});
}

export async function PUT(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx = await requireOrgContext(request,db);
  if (!ctx || ctx.role !== "admin") return Response.json({error:"Редагувати обладнання може лише адміністратор"},{status:403});
  const body = await request.json().catch(()=>({})) as {equipment?:unknown};
  const equipment = sanitizeEquipmentRegistry(body.equipment);
  await setOrgSettingCompat(db,ctx.organizationId,EQUIPMENT_REGISTRY_KEY,JSON.stringify(equipment));
  await audit(db,{
    organizationId:ctx.organizationId,
    actorEmail:ctx.member.email,
    action:"equipment_registry_update",
    resource:"equipment",
  });
  return Response.json({ok:true,equipment});
}
