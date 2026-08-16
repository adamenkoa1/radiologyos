export type ServiceDeliveryDocument = {
  id:number;
  number:string;
  occurredAt:string;
  state:string;
  createdBy:string;
  postedBy:string;
  postedAt:string;
  bookingId:number;
  bookingCode:string;
  patientName:string;
  patientId:string;
  serviceCode:string;
  serviceName:string;
  patientCategory:string;
  chargeAmount:number;
  currency:string;
  equipmentId:string;
  durationMinutes:number;
  performedAt:string;
  anatomicalRegionsCount:number;
  radiologistEmail:string;
  radiographerEmail:string;
};

function boundedLimit(value:number,max:number) {
  return Math.max(1,Math.min(max,Math.trunc(value)));
}

export async function getServiceDeliveryDocument(
  db:D1Database,
  organizationId:number,
  documentId:number,
):Promise<ServiceDeliveryDocument|null> {
  const row=await db.prepare(
    `SELECT d.id,d.number,d.occurred_at AS occurredAt,d.state,d.created_by AS createdBy,
            d.posted_by AS postedBy,d.posted_at AS postedAt,
            s.booking_id AS bookingId,b.code AS bookingCode,b.name AS patientName,
            s.patient_id AS patientId,s.service_code AS serviceCode,s.service_name AS serviceName,
            s.patient_category AS patientCategory,s.charge_amount AS chargeAmount,s.currency,
            s.equipment_id AS equipmentId,s.duration_minutes AS durationMinutes,
            s.performed_at AS performedAt,s.anatomical_regions_count AS anatomicalRegionsCount,
            s.radiologist_email AS radiologistEmail,s.radiographer_email AS radiographerEmail
     FROM business_documents d
     JOIN service_delivery_details s ON s.document_id=d.id AND s.organization_id=d.organization_id
     JOIN bookings b ON b.id=s.booking_id AND b.organization_id=s.organization_id
     WHERE d.organization_id=? AND d.id=? AND d.document_type='service_delivery' LIMIT 1`
  ).bind(organizationId,documentId).first<ServiceDeliveryDocument>();
  return row || null;
}

export async function listServiceDeliveryDocuments(db:D1Database,organizationId:number,limit=250) {
  const safeLimit=boundedLimit(limit,500);
  const rows=await db.prepare(
    `SELECT d.id,d.number,d.occurred_at AS occurredAt,d.state,d.created_by AS createdBy,
            d.posted_by AS postedBy,d.posted_at AS postedAt,
            s.booking_id AS bookingId,b.code AS bookingCode,b.name AS patientName,
            s.patient_id AS patientId,s.service_code AS serviceCode,s.service_name AS serviceName,
            s.patient_category AS patientCategory,s.charge_amount AS chargeAmount,s.currency,
            s.equipment_id AS equipmentId,s.duration_minutes AS durationMinutes,
            s.performed_at AS performedAt,s.anatomical_regions_count AS anatomicalRegionsCount,
            s.radiologist_email AS radiologistEmail,s.radiographer_email AS radiographerEmail
     FROM business_documents d
     JOIN service_delivery_details s ON s.document_id=d.id AND s.organization_id=d.organization_id
     JOIN bookings b ON b.id=s.booking_id AND b.organization_id=s.organization_id
     WHERE d.organization_id=? AND d.document_type='service_delivery'
     ORDER BY s.performed_at DESC,d.id DESC LIMIT ${safeLimit}`
  ).bind(organizationId).all();
  return rows.results;
}

export async function listRevenueMovements(db:D1Database,organizationId:number,limit=300) {
  const safeLimit=boundedLimit(limit,700);
  const rows=await db.prepare(
    `SELECT r.id,r.document_id AS documentId,d.number AS documentNumber,r.booking_id AS bookingId,
            b.code AS bookingCode,b.name AS patientName,r.movement_type AS movementType,
            r.amount_delta AS amountDelta,r.currency,r.service_code AS serviceCode,
            r.actor_email AS actorEmail,r.occurred_at AS occurredAt
     FROM revenue_movements r
     JOIN business_documents d ON d.id=r.document_id AND d.organization_id=r.organization_id
     JOIN bookings b ON b.id=r.booking_id AND b.organization_id=r.organization_id
     WHERE r.organization_id=? ORDER BY r.occurred_at DESC,r.id DESC LIMIT ${safeLimit}`
  ).bind(organizationId).all();
  return rows.results;
}

export async function listEquipmentWorkload(db:D1Database,organizationId:number,limit=300) {
  const safeLimit=boundedLimit(limit,700);
  const rows=await db.prepare(
    `SELECT w.id,w.document_id AS documentId,d.number AS documentNumber,w.booking_id AS bookingId,
            b.code AS bookingCode,w.equipment_id AS equipmentId,w.study_count AS studyCount,
            w.duration_minutes AS durationMinutes,w.anatomical_regions_count AS anatomicalRegionsCount,
            w.performed_at AS performedAt
     FROM equipment_workload_movements w
     JOIN business_documents d ON d.id=w.document_id AND d.organization_id=w.organization_id
     JOIN bookings b ON b.id=w.booking_id AND b.organization_id=w.organization_id
     WHERE w.organization_id=? ORDER BY w.performed_at DESC,w.id DESC LIMIT ${safeLimit}`
  ).bind(organizationId).all();
  return rows.results;
}

export async function listStaffOutput(db:D1Database,organizationId:number,limit=500) {
  const safeLimit=boundedLimit(limit,1000);
  const rows=await db.prepare(
    `SELECT o.id,o.document_id AS documentId,d.number AS documentNumber,o.booking_id AS bookingId,
            b.code AS bookingCode,o.staff_email AS staffEmail,o.staff_role AS staffRole,
            o.study_count AS studyCount,o.anatomical_regions_count AS anatomicalRegionsCount,
            o.performed_at AS performedAt
     FROM staff_output_movements o
     JOIN business_documents d ON d.id=o.document_id AND d.organization_id=o.organization_id
     JOIN bookings b ON b.id=o.booking_id AND b.organization_id=o.organization_id
     WHERE o.organization_id=? ORDER BY o.performed_at DESC,o.id DESC LIMIT ${safeLimit}`
  ).bind(organizationId).all();
  return rows.results;
}

export async function serviceDeliveryTotals(db:D1Database,organizationId:number) {
  const [documents,revenue,workload,staff]=await Promise.all([
    db.prepare(
      `SELECT COUNT(*) AS acts,
              SUM(CASE WHEN s.patient_category='civilian' THEN 1 ELSE 0 END) AS civilianActs,
              SUM(CASE WHEN s.patient_category='military' THEN 1 ELSE 0 END) AS militaryActs
       FROM service_delivery_details s
       JOIN business_documents d ON d.id=s.document_id AND d.organization_id=s.organization_id
       WHERE s.organization_id=? AND d.state='posted'`
    ).bind(organizationId).first<{acts:number;civilianActs:number;militaryActs:number}>(),
    db.prepare(
      `SELECT COALESCE(SUM(amount_delta),0) AS revenue FROM revenue_movements WHERE organization_id=?`
    ).bind(organizationId).first<{revenue:number}>(),
    db.prepare(
      `SELECT COALESCE(SUM(study_count),0) AS studies,
              COALESCE(SUM(duration_minutes),0) AS minutes,
              COALESCE(SUM(anatomical_regions_count),0) AS regions
       FROM equipment_workload_movements WHERE organization_id=?`
    ).bind(organizationId).first<{studies:number;minutes:number;regions:number}>(),
    db.prepare(
      `SELECT COALESCE(SUM(study_count),0) AS assignments FROM staff_output_movements WHERE organization_id=?`
    ).bind(organizationId).first<{assignments:number}>(),
  ]);
  return {
    acts:Number(documents?.acts || 0),
    civilianActs:Number(documents?.civilianActs || 0),
    militaryActs:Number(documents?.militaryActs || 0),
    revenue:Number(revenue?.revenue || 0),
    studies:Number(workload?.studies || 0),
    minutes:Number(workload?.minutes || 0),
    regions:Number(workload?.regions || 0),
    staffAssignments:Number(staff?.assignments || 0),
  };
}
