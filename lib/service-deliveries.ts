export type ServiceDeliveryBooking = {
  id:number;
  organizationId:number;
  code:string;
  patientId:string;
  patientCategory:string;
  serviceCode:string;
  serviceTitle:string;
  equipmentId:string;
  durationMinutes:number;
  anatomicalRegionsCount:number;
  performedAt:string;
  radiologistEmail:string;
  radiographerEmail:string;
  paymentAmount:number;
  status:string;
};

export type ServiceDeliveryDocument = {
  id:number;
  organizationId:number;
  number:string;
  state:string;
  bookingId:number;
  chargeAmount:number;
  priceAmount:number;
};

function actor(value:unknown) {
  return String(value ?? "").trim().toLowerCase().slice(0,254);
}

export async function serviceDeliveryBooking(
  db:D1Database,
  organizationId:number,
  bookingId:number,
):Promise<ServiceDeliveryBooking|null> {
  const row=await db.prepare(
    `SELECT id,organization_id AS organizationId,code,patient_id AS patientId,
            patient_category AS patientCategory,service_code AS serviceCode,service AS serviceTitle,
            equipment_id AS equipmentId,duration_minutes AS durationMinutes,
            anatomical_regions_count AS anatomicalRegionsCount,performed_at AS performedAt,
            assigned_radiologist_email AS radiologistEmail,
            assigned_radiographer_email AS radiographerEmail,
            payment_amount AS paymentAmount,status
     FROM bookings WHERE organization_id=? AND id=? LIMIT 1`
  ).bind(organizationId,bookingId).first<ServiceDeliveryBooking>();
  return row || null;
}

export async function existingServiceDelivery(
  db:D1Database,
  organizationId:number,
  bookingId:number,
):Promise<ServiceDeliveryDocument|null> {
  const row=await db.prepare(
    `SELECT d.id,d.organization_id AS organizationId,d.number,d.state,s.booking_id AS bookingId,
            s.charge_amount AS chargeAmount,s.price_amount AS priceAmount
     FROM business_documents d
     JOIN service_delivery_details s ON s.document_id=d.id AND s.organization_id=d.organization_id
     WHERE d.organization_id=? AND s.booking_id=? AND d.document_type='service_delivery'
       AND d.state IN ('draft','posted')
     ORDER BY d.id DESC LIMIT 1`
  ).bind(organizationId,bookingId).first<ServiceDeliveryDocument>();
  return row || null;
}

async function cleanupDraft(db:D1Database,organizationId:number,documentId:number) {
  const row=await db.prepare(
    "SELECT state FROM business_documents WHERE organization_id=? AND id=? LIMIT 1"
  ).bind(organizationId,documentId).first<{state:string}>();
  if(!row || row.state!=="draft") return;
  await db.prepare("DELETE FROM service_delivery_details WHERE organization_id=? AND document_id=?")
    .bind(organizationId,documentId).run().catch(()=>{});
  await db.prepare("DELETE FROM business_documents WHERE organization_id=? AND id=? AND state='draft'")
    .bind(organizationId,documentId).run().catch(()=>{});
}

export async function postServiceDelivery(
  db:D1Database,
  input:{organizationId:number;bookingId:number;actorEmail:string},
) {
  const existing=await existingServiceDelivery(db,input.organizationId,input.bookingId);
  if(existing?.state === "posted") return {document:existing,created:false};
  if(existing) throw new Error("service_delivery_in_progress");

  const booking=await serviceDeliveryBooking(db,input.organizationId,input.bookingId);
  if(!booking) throw new Error("booking_not_found");
  if(booking.status!=="completed" || !booking.performedAt) throw new Error("service_not_performed");
  if(!Number.isInteger(booking.durationMinutes) || booking.durationMinutes<=0) throw new Error("service_duration_invalid");
  if(!Number.isInteger(booking.anatomicalRegionsCount) || booking.anatomicalRegionsCount<=0) throw new Error("service_regions_invalid");
  if(!Number.isInteger(booking.paymentAmount) || booking.paymentAmount<0) throw new Error("service_price_invalid");

  const createdBy=actor(input.actorEmail);
  if(!createdBy) throw new Error("service_actor_required");
  const chargeAmount=booking.patientCategory === "civilian" ? booking.paymentAmount : 0;

  const created=await db.prepare(
    `INSERT INTO business_documents
      (organization_id,document_type,number,occurred_at,state,comment,created_by)
     VALUES (?,'service_delivery','',?,'draft',?,?)`
  ).bind(input.organizationId,booking.performedAt,`Надання послуги за заявкою ${booking.code}`,createdBy).run();
  const documentId=Number(created.meta.last_row_id || 0);
  if(!documentId) throw new Error("service_delivery_create_failed");
  const number=`НП-${String(documentId).padStart(6,"0")}`;

  try {
    await db.prepare(
      "UPDATE business_documents SET number=? WHERE organization_id=? AND id=? AND state='draft'"
    ).bind(number,input.organizationId,documentId).run();
    await db.prepare(
      `INSERT INTO service_delivery_details
       (organization_id,document_id,booking_id,patient_id,patient_category,service_code,service_title,
        equipment_id,duration_minutes,anatomical_regions_count,performed_at,radiologist_email,
        radiographer_email,price_amount,charge_amount,currency)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'UAH')`
    ).bind(
      input.organizationId,documentId,booking.id,booking.patientId || "",booking.patientCategory,
      booking.serviceCode,booking.serviceTitle,booking.equipmentId,booking.durationMinutes,
      booking.anatomicalRegionsCount,booking.performedAt,booking.radiologistEmail || "",
      booking.radiographerEmail || "",booking.paymentAmount,chargeAmount,
    ).run();

    const postedAt=new Date().toISOString();
    const statements:unknown[]=[
      db.prepare(
        `UPDATE business_documents SET state='posted',posted_by=?,posted_at=?
         WHERE organization_id=? AND id=? AND state='draft'`
      ).bind(createdBy,postedAt,input.organizationId,documentId),
      db.prepare(
        `INSERT INTO services_delivered_movements
         (organization_id,document_id,booking_id,patient_id,service_code,equipment_id,quantity,
          anatomical_regions_count,performed_at,actor_email,occurred_at)
         VALUES (?,?,?,?,?,?,1,?,?,?,?,?)`
      ).bind(
        input.organizationId,documentId,booking.id,booking.patientId || "",booking.serviceCode,
        booking.equipmentId,booking.anatomicalRegionsCount,booking.performedAt,createdBy,booking.performedAt,
      ),
      db.prepare(
        `INSERT INTO equipment_load_movements
         (organization_id,document_id,booking_id,equipment_id,minutes_delta,performed_at,actor_email,occurred_at)
         VALUES (?,?,?,?,?,?,?,?)`
      ).bind(
        input.organizationId,documentId,booking.id,booking.equipmentId,booking.durationMinutes,
        booking.performedAt,createdBy,booking.performedAt,
      ),
    ];

    if(chargeAmount>0) {
      statements.push(
        db.prepare(
          `INSERT INTO revenue_movements
           (organization_id,document_id,booking_id,patient_id,service_code,movement_type,amount_delta,currency,actor_email,occurred_at)
           VALUES (?,?,?,?,?,'service_delivery',?,'UAH',?,?)`
        ).bind(
          input.organizationId,documentId,booking.id,booking.patientId || "",booking.serviceCode,
          chargeAmount,createdBy,booking.performedAt,
        ),
        db.prepare(
          `INSERT INTO patient_settlement_movements
           (organization_id,document_id,booking_id,patient_id,movement_type,amount_delta,currency,actor_email,occurred_at)
           VALUES (?,?,?,?,'charge',?,'UAH',?,?)`
        ).bind(
          input.organizationId,documentId,booking.id,booking.patientId || "",chargeAmount,createdBy,booking.performedAt,
        ),
      );
    }
    if(booking.radiologistEmail) {
      statements.push(db.prepare(
        `INSERT INTO staff_output_movements
         (organization_id,document_id,booking_id,member_email,staff_role,units_delta,anatomical_regions_count,performed_at,actor_email,occurred_at)
         VALUES (?,?,?,?,'radiologist',1,?,?,?,?)`
      ).bind(
        input.organizationId,documentId,booking.id,booking.radiologistEmail,
        booking.anatomicalRegionsCount,booking.performedAt,createdBy,booking.performedAt,
      ));
    }
    if(booking.radiographerEmail) {
      statements.push(db.prepare(
        `INSERT INTO staff_output_movements
         (organization_id,document_id,booking_id,member_email,staff_role,units_delta,anatomical_regions_count,performed_at,actor_email,occurred_at)
         VALUES (?,?,?,?,'radiographer',1,?,?,?,?)`
      ).bind(
        input.organizationId,documentId,booking.id,booking.radiographerEmail,
        booking.anatomicalRegionsCount,booking.performedAt,createdBy,booking.performedAt,
      ));
    }
    await db.batch(statements);
  } catch(error) {
    await cleanupDraft(db,input.organizationId,documentId);
    const message=String(error).toLowerCase();
    if(message.includes("service_delivery_already_exists")) {
      const race=await existingServiceDelivery(db,input.organizationId,input.bookingId);
      if(race?.state === "posted") return {document:race,created:false};
    }
    throw error;
  }

  return {
    document:{
      id:documentId,organizationId:input.organizationId,number,state:"posted",
      bookingId:booking.id,chargeAmount,priceAmount:booking.paymentAmount,
    } satisfies ServiceDeliveryDocument,
    created:true,
  };
}

export async function listServiceDeliveries(db:D1Database,organizationId:number,limit=200) {
  const safeLimit=Math.max(1,Math.min(500,Math.trunc(limit)));
  const rows=await db.prepare(
    `SELECT d.id,d.number,d.occurred_at AS occurredAt,d.state,d.posted_by AS postedBy,
            s.booking_id AS bookingId,b.code AS bookingCode,b.name AS patientName,
            s.patient_id AS patientId,s.patient_category AS patientCategory,
            s.service_code AS serviceCode,s.service_title AS serviceTitle,s.equipment_id AS equipmentId,
            s.duration_minutes AS durationMinutes,s.anatomical_regions_count AS anatomicalRegionsCount,
            s.performed_at AS performedAt,s.radiologist_email AS radiologistEmail,
            s.radiographer_email AS radiographerEmail,s.price_amount AS priceAmount,
            s.charge_amount AS chargeAmount,s.currency
     FROM business_documents d
     JOIN service_delivery_details s ON s.document_id=d.id AND s.organization_id=d.organization_id
     JOIN bookings b ON b.id=s.booking_id AND b.organization_id=s.organization_id
     WHERE d.organization_id=? AND d.document_type='service_delivery'
     ORDER BY d.occurred_at DESC,d.id DESC LIMIT ${safeLimit}`
  ).bind(organizationId).all();
  return rows.results;
}
