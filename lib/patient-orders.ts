export type PatientOrderRow={
  id:number;organizationId:number;number:string;state:string;occurredAt:string;createdBy:string;postedBy:string;postedAt:string;
  bookingId:number;patientId:string;patientCategory:string;serviceCode:string;serviceTitle:string;equipmentId:string;
  durationMinutes:number;priceAmount:number;chargeAmount:number;currency:string;
};

export async function getPatientOrderForBooking(
  db:D1Database,
  organizationId:number,
  bookingId:number,
):Promise<PatientOrderRow|null>{
  const row=await db.prepare(
    `SELECT d.id,d.organization_id AS organizationId,d.number,d.state,d.occurred_at AS occurredAt,
            d.created_by AS createdBy,d.posted_by AS postedBy,d.posted_at AS postedAt,
            o.booking_id AS bookingId,o.patient_id AS patientId,o.patient_category AS patientCategory,
            o.service_code AS serviceCode,o.service_title AS serviceTitle,o.equipment_id AS equipmentId,
            o.duration_minutes AS durationMinutes,o.price_amount AS priceAmount,o.charge_amount AS chargeAmount,o.currency
     FROM patient_order_details o
     JOIN business_documents d ON d.id=o.document_id AND d.organization_id=o.organization_id
     WHERE o.organization_id=? AND o.booking_id=? AND d.document_type='patient_order'
     LIMIT 1`
  ).bind(organizationId,bookingId).first<PatientOrderRow>();
  return row||null;
}

export async function listPatientOrders(db:D1Database,organizationId:number,limit=250){
  const safeLimit=Math.max(1,Math.min(500,Math.trunc(limit)));
  const rows=await db.prepare(
    `SELECT d.id,d.organization_id AS organizationId,d.number,d.state,d.occurred_at AS occurredAt,
            d.created_by AS createdBy,d.posted_by AS postedBy,d.posted_at AS postedAt,
            o.booking_id AS bookingId,o.patient_id AS patientId,o.patient_category AS patientCategory,
            o.service_code AS serviceCode,o.service_title AS serviceTitle,o.equipment_id AS equipmentId,
            o.duration_minutes AS durationMinutes,o.price_amount AS priceAmount,o.charge_amount AS chargeAmount,o.currency,
            b.code AS bookingCode,b.name AS patientName
     FROM patient_order_details o
     JOIN business_documents d ON d.id=o.document_id AND d.organization_id=o.organization_id
     JOIN bookings b ON b.id=o.booking_id AND b.organization_id=o.organization_id
     WHERE o.organization_id=? AND d.document_type='patient_order'
     ORDER BY d.occurred_at DESC,d.id DESC LIMIT ${safeLimit}`
  ).bind(organizationId).all();
  return rows.results;
}
