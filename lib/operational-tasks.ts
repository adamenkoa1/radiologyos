import { audit } from "./audit";

type Candidate = {
  organizationId:number;
  key:string;
  title:string;
  details:string;
  priority:"normal"|"high";
  dueDate:string;
  assignedEmail:string;
  sourceEntityType:"inventory_item"|"equipment_maintenance";
  sourceEntityId:string;
};

function kyivDate(now:number) {
  return new Intl.DateTimeFormat("en-CA",{
    timeZone:"Europe/Kyiv",year:"numeric",month:"2-digit",day:"2-digit",
  }).format(new Date(now));
}

async function activeAssignee(db:D1Database,organizationId:number,email:string) {
  if(!email)return "";
  const row=await db.prepare(`SELECT 1 AS ok FROM memberships m
    JOIN staff_members s ON s.email=m.member_email AND s.active=1
    WHERE m.organization_id=? AND m.member_email=? AND m.active=1 LIMIT 1`)
    .bind(organizationId,email).first<{ok:number}>();
  return row?.ok?email:"";
}

async function candidatesForOrg(db:D1Database,organizationId:number,today:string):Promise<Candidate[]> {
  const [inventory,maintenance]=await Promise.all([
    db.prepare(`SELECT i.id,i.name,i.unit,i.min_stock AS minStock,
        COALESCE(SUM(m.quantity_delta),0) AS stock
      FROM inventory_items i
      LEFT JOIN inventory_lots l ON l.organization_id=i.organization_id AND l.item_id=i.id
      LEFT JOIN inventory_movements m ON m.organization_id=i.organization_id AND m.item_id=i.id AND m.lot_id=l.id
      WHERE i.organization_id=? AND i.active=1 AND i.min_stock>0
      GROUP BY i.id
      HAVING stock <= i.min_stock + 0.000001`)
      .bind(organizationId).all<{id:number;name:string;unit:string;minStock:number;stock:number}>(),
    db.prepare(`SELECT id,equipment_id AS equipmentId,event_type AS eventType,title,
        assigned_email AS assignedEmail,due_date AS dueDate,downtime_start AS downtimeStart
      FROM equipment_maintenance
      WHERE organization_id=? AND status IN ('open','in_progress')
        AND ((due_date<>'' AND due_date<?)
          OR (event_type IN ('fault','repair') AND downtime_start<>'' AND downtime_end=''))
      ORDER BY id`)
      .bind(organizationId,today).all<{id:number;equipmentId:string;eventType:string;title:string;assignedEmail:string;dueDate:string;downtimeStart:string}>(),
  ]);

  const out:Candidate[]=[];
  for(const item of inventory.results||[]) {
    out.push({
      organizationId,key:`inventory:low:${item.id}`,
      title:`Поповнити запас: ${item.name}`,
      details:`Поточний залишок: ${Number(item.stock)} ${item.unit}. Мінімальний запас: ${Number(item.minStock)} ${item.unit}.`,
      priority:"high",dueDate:today,assignedEmail:"",
      sourceEntityType:"inventory_item",sourceEntityId:String(item.id),
    });
  }
  for(const event of maintenance.results||[]) {
    const overdue=!!event.dueDate&&event.dueDate<today;
    const assignedEmail=await activeAssignee(db,organizationId,event.assignedEmail||"");
    out.push({
      organizationId,key:`maintenance:attention:${event.id}`,
      title:`Контроль обладнання: ${event.title}`,
      details:overdue
        ? `Обладнання: ${event.equipmentId}. Строк ${event.dueDate} прострочено.`
        : `Обладнання: ${event.equipmentId}. Зафіксований активний простій з ${event.downtimeStart}.`,
      priority:"high",dueDate:event.dueDate||today,assignedEmail,
      sourceEntityType:"equipment_maintenance",sourceEntityId:String(event.id),
    });
  }
  return out;
}

export async function runOperationalTasks(db:D1Database,now=Date.now()):Promise<{created:number;resolved:number}> {
  const today=kyivDate(now);
  const organizations=await db.prepare("SELECT id FROM organizations WHERE active=1 ORDER BY id").all<{id:number}>();
  let created=0,resolved=0;

  for(const org of organizations.results||[]) {
    const candidates=await candidatesForOrg(db,org.id,today);
    const activeKeys=new Set(candidates.map(c=>c.key));

    for(const task of candidates) {
      const result=await db.prepare(`INSERT OR IGNORE INTO staff_tasks
        (organization_id,title,details,status,priority,due_date,assigned_email,created_by,
         source,automation_key,source_entity_type,source_entity_id)
        VALUES (?,?,?,'open',?,?,?,'system:automation','automation',?,?,?)`)
        .bind(task.organizationId,task.title,task.details,task.priority,task.dueDate,task.assignedEmail,
          task.key,task.sourceEntityType,task.sourceEntityId).run();
      if(Number(result.meta.changes||0)>0) {
        created++;
        const id=Number(result.meta.last_row_id||0);
        await audit(db,{organizationId:task.organizationId,actorEmail:"system:automation",action:"task_auto_created",resource:"task",targetId:id,details:{source:task.sourceEntityType,sourceId:task.sourceEntityId}});
      }
    }

    const open=await db.prepare(`SELECT id,automation_key AS automationKey,source_entity_type AS sourceType,source_entity_id AS sourceId
      FROM staff_tasks WHERE organization_id=? AND status='open' AND source='automation' AND automation_key<>''`)
      .bind(org.id).all<{id:number;automationKey:string;sourceType:string;sourceId:string}>();
    for(const task of open.results||[]) {
      if(activeKeys.has(task.automationKey))continue;
      const result=await db.prepare(`UPDATE staff_tasks SET status='done',completed_by='system:automation',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE organization_id=? AND id=? AND status='open' AND source='automation'`)
        .bind(org.id,task.id).run();
      if(Number(result.meta.changes||0)>0) {
        resolved++;
        await audit(db,{organizationId:org.id,actorEmail:"system:automation",action:"task_auto_resolved",resource:"task",targetId:task.id,details:{source:task.sourceType,sourceId:task.sourceId}});
      }
    }
  }
  return {created,resolved};
}
