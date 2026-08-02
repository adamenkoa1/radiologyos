import { requireStaff } from "../../../../lib/staff-auth";
import { audit } from "../../../../lib/audit";
import { dbBinding } from "../../../../lib/db";
import { getSetting, setSetting } from "../../../../lib/settings";
import { EQUIPMENT_REGISTRY_KEY, parseEquipmentRegistry, sanitizeEquipmentRegistry } from "../../../../lib/equipment-registry";

export async function GET(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({error:"База тимчасово недоступна"},{status:503});
  const member = await requireStaff(request,db);
  if (!member) return Response.json({error:"Доступ лише для персоналу"},{status:403});
  const equipment = parseEquipmentRegistry(await getSetting(db,EQUIPMENT_REGISTRY_KEY));
  return Response.json({equipment,staff:member},{headers:{"cache-control":"no-store"}});
}

export async function PUT(request:Request) {
  const db = dbBinding();
  if (!db) return Response.json({error:"База тимчасово недоступна"},{status:503});
  const member = await requireStaff(request,db);
  if (!member || member.role !== "admin") return Response.json({error:"Редагувати обладнання може лише адміністратор"},{status:403});
  const body = await request.json().catch(()=>({})) as {equipment?:unknown};
  const equipment = sanitizeEquipmentRegistry(body.equipment);
  await setSetting(db,EQUIPMENT_REGISTRY_KEY,JSON.stringify(equipment));
  await audit(db,{organizationId:1,actorEmail:member.email,action:"equipment_registry_update",resource:"equipment"});
  return Response.json({ok:true,equipment});
}
