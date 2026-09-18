export type PatientOrderRow={
  id:number;organizationId:number;number:string;state:string;occurredAt:string;createdBy:string;postedBy:string;postedAt:string;
  bookingId:number;patientId:string;patientCategory:string;serviceCode:string;serviceTitle:string;equipmentId:string;
  durationMinutes:number;priceAmount:number;chargeAmount:number;currency:string;
};

export type PatientOrderCancellationBlocker=
  |"payment_refund_required"
  |"service_storno_required"
  |"downstream_draft_exists";

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

export async function patientOrderCancellationBlocker(
  db:D1Database,
  organizationId:number,
  bookingId:number,
):Promise<PatientOrderCancellationBlocker|null>{
  const paid=await db.prepare(
    `SELECT 1 AS found FROM payment_transactions
     WHERE organization_id=? AND booking_id=? AND status='paid' LIMIT 1`
  ).bind(organizationId,bookingId).first();
  if(paid)return "payment_refund_required";

  const delivered=await db.prepare(
    `SELECT 1 AS found
     FROM service_delivery_details s
     JOIN business_documents d ON d.id=s.document_id AND d.organization_id=s.organization_id
     WHERE s.organization_id=? AND s.booking_id=?
       AND d.document_type='service_delivery' AND d.state='posted'
     LIMIT 1`
  ).bind(organizationId,bookingId).first();
  if(delivered)return "service_storno_required";

  const draft=await db.prepare(
    `SELECT 1 AS found
     FROM patient_order_details o
     JOIN business_documents child
       ON child.organization_id=o.organization_id AND child.basis_document_id=o.document_id
     WHERE o.organization_id=? AND o.booking_id=?
       AND child.state='draft' AND child.document_type IN ('payment','service_delivery')
     LIMIT 1`
  ).bind(organizationId,bookingId).first();
  if(draft)return "downstream_draft_exists";

  return null;
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
