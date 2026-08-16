import { dbBinding } from "../../../../lib/db";
import {
  listEquipmentWorkload,
  listRevenueMovements,
  listServiceDeliveryDocuments,
  listStaffOutput,
  serviceDeliveryTotals,
} from "../../../../lib/service-delivery";
import { canManageFinance } from "../../../../lib/staff-auth";
import { requireOrgContext } from "../../../../lib/tenant";

export async function GET(request:Request) {
  const db=dbBinding();
  if(!db) return Response.json({error:"База тимчасово недоступна"},{status:503});
  const ctx=await requireOrgContext(request,db);
  if(!ctx) return Response.json({error:"Доступ лише для персоналу"},{status:403});
  if(!canManageFinance(ctx.member.role)) {
    return Response.json({error:"Журнал наданих послуг доступний реєстратору або адміністратору"},{status:403});
  }

  const [totals,documents,revenueMovements,equipmentWorkload,staffOutput]=await Promise.all([
    serviceDeliveryTotals(db,ctx.organizationId),
    listServiceDeliveryDocuments(db,ctx.organizationId),
    listRevenueMovements(db,ctx.organizationId),
    listEquipmentWorkload(db,ctx.organizationId),
    listStaffOutput(db,ctx.organizationId),
  ]);

  return Response.json({
    totals,
    documents,
    revenueMovements,
    equipmentWorkload,
    staffOutput,
  });
}
