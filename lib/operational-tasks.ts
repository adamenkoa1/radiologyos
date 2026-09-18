import { stateLabel } from "./study-state.ts";

type Candidate = {
  organizationId:number;
  key:string;
  title:string;
  details:string;
  priority:"normal"|"high";
  dueDate:string;
  bookingId:number|null;
  assignedEmail:string;
  sourceEntityType:"inventory_item"|"equipment_maintenance"|"booking";
  sourceEntityId:string;
};

type BookingCandidateRow = {
  id:number;
  status:string;
  desiredDate:string;
  assignedRadiologistEmail:string;
  assignedRadiographerEmail:string;
};

type ClinicalHandoff = {
  stage:"verification"|"acquisition"|"reporting"|"issuance";
  title:string;
  priority:"normal"|"high";
  assignee:""|"radiologist"|"radiographer";
};

function kyivDate(now:number) {
  return new Intl.DateTimeFormat("en-CA",{
    timeZone:"Europe/Kyiv",year:"numeric",month:"2-digit",day:"2-digit",
  }).format(new Date(now));
}

function clinicalHandoff(status:string):ClinicalHandoff|null {
  if(status==="new"||status==="requested"||status==="needs_verification") {
    return {stage:"verification",title:"Перевірити заявку на дослідження",priority:"normal",assignee:""};
  }
  if(status==="arrived"||status==="queued"||status==="in_progress") {
    return {stage:"acquisition",title:"Провести дослідження",priority:"normal",assignee:"radiographer"};
  }
  if(status==="performed"||status==="images_ready"||status==="reporting") {
    return {stage:"reporting",title:"Підготувати протокол дослідження",priority:"high",assignee:"radiologist"};
  }
  if(status==="protocol_ready") {
    return {stage:"issuance",title:"Видати готовий результат",priority:"normal",assignee:""};
  }
  return null;
}

async function auditAutomation(
  db:D1Database,
  organizationId:number,
  action:"task_auto_created"|"task_auto_resolved",
  targetId:number,
  source:string,
  sourceId:string,
) {
  try {
    const details=JSON.stringify({source,sourceId}).slice(0,4000);
    await db.prepare(`INSERT INTO security_audit_log
      (organization_id,actor_email,action,resource,target_id,details_json)
      VALUES (?,'system:automation',?,'task',?,?)`)
      .bind(organizationId,action,String(targetId),details).run();
  } catch {
    // Audit must never block the operational task run.
  }
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
  const [inventory,maintenance,bookings]=await Promise.all([
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
    db.prepare(`SELECT id,status,desired_date AS desiredDate,
        assigned_radiologist_email AS assignedRadiologistEmail,
        assigned_radiographer_email AS assignedRadiographerEmail
      FROM bookings
      WHERE organization_id=? AND status IN (
        'new','requested','needs_verification','arrived','queued','in_progress',
        'performed','images_ready','reporting','protocol_ready'
      )
      ORDER BY id`)
      .bind(organizationId).all<BookingCandidateRow>(),
  ]);

  const out:Candidate[]=[];
  for(const item of inventory.results||[]) {
    out.push({
      organizationId,key:`inventory:low:${item.id}`,
      title:`Поповнити запас: ${item.name}`,
      details:`Поточний залишок: ${Number(item.stock)} ${item.unit}. Мінімальний запас: ${Number(item.minStock)} ${item.unit}.`,
      priority:"high",dueDate:today,bookingId:null,assignedEmail:"",
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
      priority:"high",dueDate:event.dueDate||today,bookingId:null,assignedEmail,
      sourceEntityType:"equipment_maintenance",sourceEntityId:String(event.id),
    });
  }
  for(const booking of bookings.results||[]) {
    const handoff=clinicalHandoff(booking.status);
    if(!handoff)continue;
    const requestedAssignee=handoff.assignee==="radiologist"
      ? booking.assignedRadiologistEmail
      : handoff.assignee==="radiographer"
        ? booking.assignedRadiographerEmail
        : "";
    const assignedEmail=await activeAssignee(db,organizationId,requestedAssignee||"");
    out.push({
      organizationId,key:`booking:${handoff.stage}:${booking.id}`,
      title:handoff.title,
      details:`Поточний етап: ${stateLabel(booking.status)}. Відкрийте картку дослідження та виконайте наступний крок.`,
      priority:handoff.priority,dueDate:booking.desiredDate||today,bookingId:booking.id,assignedEmail,
      sourceEntityType:"booking",sourceEntityId:String(booking.id),
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
      await db.prepare(`UPDATE staff_tasks SET
          title=?,details=?,priority=?,due_date=?,booking_id=?,assigned_email=?,
          source_entity_type=?,source_entity_id=?,updated_at=CURRENT_TIMESTAMP
        WHERE organization_id=? AND status='open' AND source='automation' AND automation_key=?`)
        .bind(task.title,task.details,task.priority,task.dueDate,task.bookingId,task.assignedEmail,
          task.sourceEntityType,task.sourceEntityId,task.organizationId,task.key).run();

      const result=await db.prepare(`INSERT OR IGNORE INTO staff_tasks
        (organization_id,title,details,status,priority,due_date,booking_id,assigned_email,created_by,
         source,automation_key,source_entity_type,source_entity_id)
        VALUES (?,?,?,'open',?,?,?,?,'system:automation','automation',?,?,?)`)
        .bind(task.organizationId,task.title,task.details,task.priority,task.dueDate,task.bookingId,task.assignedEmail,
          task.key,task.sourceEntityType,task.sourceEntityId).run();
      if(Number(result.meta.changes||0)>0) {
        created++;
        const id=Number(result.meta.last_row_id||0);
        await auditAutomation(db,task.organizationId,"task_auto_created",id,task.sourceEntityType,task.sourceEntityId);
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
        await auditAutomation(db,org.id,"task_auto_resolved",task.id,task.sourceType,task.sourceId);
      }
    }
  }
  return {created,resolved};
}
