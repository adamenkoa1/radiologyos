export type ServiceCorrectionSource={
  documentId:number;documentNumber:string;documentState:string;bookingId:number;patientId:string;patientCategory:string;
  serviceCode:string;serviceTitle:string;equipmentId:string;durationMinutes:number;anatomicalRegionsCount:number;
  performedAt:string;radiologistEmail:string;radiographerEmail:string;chargeAmount:number;currency:string;
};

export type ServiceCorrectionDocument={
  id:number;number:string;state:string;sourceDocumentId:number;sourceDocumentNumber:string;bookingId:number;
  reason:string;chargeAmount:number;currency:string;created:false|true;
};

function clean(value:unknown,max:number) {
  return typeof value==="string"?value.trim().slice(0,max):"";
}

function actor(value:unknown) {
  return clean(value,254).toLowerCase();
}

export async function serviceCorrectionSource(
  db:D1Database,
  organizationId:number,
  sourceDocumentId:number,
):Promise<ServiceCorrectionSource|null> {
  const row=await db.prepare(
    `SELECT d.id AS documentId,d.number AS documentNumber,d.state AS documentState,
            s.booking_id AS bookingId,s.patient_id AS patientId,s.patient_category AS patientCategory,
            s.service_code AS serviceCode,s.service_title AS serviceTitle,s.equipment_id AS equipmentId,
            s.duration_minutes AS durationMinutes,s.anatomical_regions_count AS anatomicalRegionsCount,
            s.performed_at AS performedAt,s.radiologist_email AS radiologistEmail,
            s.radiographer_email AS radiographerEmail,s.charge_amount AS chargeAmount,s.currency
     FROM business_documents d
     JOIN service_delivery_details s ON s.document_id=d.id AND s.organization_id=d.organization_id
     WHERE d.organization_id=? AND d.id=? AND d.document_type='service_delivery'
     LIMIT 1`
  ).bind(organizationId,sourceDocumentId).first<ServiceCorrectionSource>();
  return row || null;
}

export async function existingServiceCorrection(
  db:D1Database,
  organizationId:number,
  sourceDocumentId:number,
) {
  const row=await db.prepare(
    `SELECT d.id,d.number,d.state,c.source_document_id AS sourceDocumentId,src.number AS sourceDocumentNumber,
            c.booking_id AS bookingId,c.reason,c.charge_amount AS chargeAmount,c.currency
     FROM service_correction_details c
     JOIN business_documents d ON d.id=c.document_id AND d.organization_id=c.organization_id
     JOIN business_documents src ON src.id=c.source_document_id AND src.organization_id=c.organization_id
     WHERE c.organization_id=? AND c.source_document_id=?
     ORDER BY d.id DESC LIMIT 1`
  ).bind(organizationId,sourceDocumentId).first<{
    id:number;number:string;state:string;sourceDocumentId:number;sourceDocumentNumber:string;
    bookingId:number;reason:string;chargeAmount:number;currency:string;
  }>();
  return row || null;
}

async function cleanupDraft(db:D1Database,organizationId:number,documentId:number) {
  const row=await db.prepare(
    "SELECT state FROM business_documents WHERE organization_id=? AND id=? LIMIT 1"
  ).bind(organizationId,documentId).first<{state:string}>();
  if(!row || row.state!=="draft") return;
  await db.prepare("DELETE FROM service_correction_details WHERE organization_id=? AND document_id=?")
    .bind(organizationId,documentId).run().catch(()=>{});
  await db.prepare("DELETE FROM business_documents WHERE organization_id=? AND id=? AND state='draft'")
    .bind(organizationId,documentId).run().catch(()=>{});
}

export async function postServiceStorno(
  db:D1Database,
  input:{organizationId:number;sourceDocumentId:number;reason:string;actorEmail:string},
):Promise<ServiceCorrectionDocument> {
  const reason=clean(input.reason,500);
  if(reason.length<5) throw new Error("service_correction_reason_required");
  const createdBy=actor(input.actorEmail);
  if(!createdBy) throw new Error("service_correction_actor_required");

  const existing=await existingServiceCorrection(db,input.organizationId,input.sourceDocumentId);
  if(existing?.state==="posted") return {...existing,created:false};
  if(existing) throw new Error("service_correction_in_progress");

  const source=await serviceCorrectionSource(db,input.organizationId,input.sourceDocumentId);
  if(!source) throw new Error("service_delivery_not_found");
  if(source.documentState==="reversed") {
    const reversed=await existingServiceCorrection(db,input.organizationId,input.sourceDocumentId);
    if(reversed?.state==="posted") return {...reversed,created:false};
    throw new Error("service_delivery_already_reversed");
  }
  if(source.documentState!=="posted") throw new Error("service_delivery_not_posted");

  const occurredAt=new Date().toISOString();
  const created=await db.prepare(
    `INSERT INTO business_documents
      (organization_id,document_type,number,occurred_at,state,comment,created_by,reversed_document_id)
     VALUES (?,'service_delivery','',?,'draft',?,?,?)`
  ).bind(
    input.organizationId,occurredAt,`Сторно ${source.documentNumber}: ${reason}`,createdBy,source.documentId,
  ).run();
  const documentId=Number(created.meta.last_row_id || 0);
  if(!documentId) throw new Error("service_correction_create_failed");
  const number=`СТ-${String(documentId).padStart(6,"0")}`;

  try {
    await db.prepare(
      "UPDATE business_documents SET number=? WHERE organization_id=? AND id=? AND state='draft'"
    ).bind(number,input.organizationId,documentId).run();
    await db.prepare(
      `INSERT INTO service_correction_details
       (organization_id,document_id,source_document_id,booking_id,correction_kind,reason,patient_id,patient_category,
        service_code,service_title,equipment_id,duration_minutes,anatomical_regions_count,performed_at,
        radiologist_email,radiographer_email,charge_amount,currency)
       VALUES (?,?,?,?,'storno',?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      input.organizationId,documentId,source.documentId,source.bookingId,reason,source.patientId,source.patientCategory,
      source.serviceCode,source.serviceTitle,source.equipmentId,source.durationMinutes,source.anatomicalRegionsCount,
      source.performedAt,source.radiologistEmail,source.radiographerEmail,source.chargeAmount,source.currency,
    ).run();

    const statements:D1PreparedStatement[]=[
      db.prepare(
        `UPDATE business_documents SET state='posted',posted_by=?,posted_at=?
         WHERE organization_id=? AND id=? AND state='draft'`
      ).bind(createdBy,occurredAt,input.organizationId,documentId),
      db.prepare(
        `UPDATE business_documents SET state='reversed'
         WHERE organization_id=? AND id=? AND state='posted' AND document_type='service_delivery'`
      ).bind(input.organizationId,source.documentId),
      db.prepare(
        `INSERT INTO service_correction_movements
         (organization_id,document_id,source_document_id,booking_id,patient_id,service_code,equipment_id,
          quantity_delta,anatomical_regions_delta,reason,actor_email,occurred_at)
         VALUES (?,?,?,?,?,?,?,-1,?,?,?,?,?)`
      ).bind(
        input.organizationId,documentId,source.documentId,source.bookingId,source.patientId,source.serviceCode,
        source.equipmentId,-source.anatomicalRegionsCount,reason,createdBy,occurredAt,
      ),
      db.prepare(
        `INSERT INTO equipment_load_movements
         (organization_id,document_id,booking_id,equipment_id,minutes_delta,performed_at,actor_email,occurred_at)
         VALUES (?,?,?,?,?,?,?,?)`
      ).bind(
        input.organizationId,documentId,source.bookingId,source.equipmentId,-source.durationMinutes,
        source.performedAt,createdBy,occurredAt,
      ),
    ];

    if(source.chargeAmount>0) {
      statements.push(
        db.prepare(
          `INSERT INTO revenue_movements
           (organization_id,document_id,booking_id,patient_id,service_code,movement_type,amount_delta,currency,actor_email,occurred_at)
           VALUES (?,?,?,?,?,'service_correction',?,?,?,?)`
        ).bind(
          input.organizationId,documentId,source.bookingId,source.patientId,source.serviceCode,-source.chargeAmount,
          source.currency,createdBy,occurredAt,
        ),
        db.prepare(
          `INSERT INTO patient_settlement_movements
           (organization_id,document_id,booking_id,patient_id,movement_type,amount_delta,currency,actor_email,occurred_at)
           VALUES (?,?,?,?,'adjustment',?,?,?,?)`
        ).bind(
          input.organizationId,documentId,source.bookingId,source.patientId,-source.chargeAmount,
          source.currency,createdBy,occurredAt,
        ),
      );
    }
    if(source.radiologistEmail) {
      statements.push(db.prepare(
        `INSERT INTO staff_output_movements
         (organization_id,document_id,booking_id,member_email,staff_role,units_delta,anatomical_regions_count,performed_at,actor_email,occurred_at)
         VALUES (?,?,?,?,'radiologist',-1,?,?,?,?)`
      ).bind(
        input.organizationId,documentId,source.bookingId,source.radiologistEmail,
        source.anatomicalRegionsCount,source.performedAt,createdBy,occurredAt,
      ));
    }
    if(source.radiographerEmail) {
      statements.push(db.prepare(
        `INSERT INTO staff_output_movements
         (organization_id,document_id,booking_id,member_email,staff_role,units_delta,anatomical_regions_count,performed_at,actor_email,occurred_at)
         VALUES (?,?,?,?,'radiographer',-1,?,?,?,?)`
      ).bind(
        input.organizationId,documentId,source.bookingId,source.radiographerEmail,
        source.anatomicalRegionsCount,source.performedAt,createdBy,occurredAt,
      ));
    }
    await db.batch(statements);
  } catch(error) {
    await cleanupDraft(db,input.organizationId,documentId);
    const text=String(error).toLowerCase();
    if(text.includes("service_correction_source_unique") || text.includes("unique constraint")) {
      const race=await existingServiceCorrection(db,input.organizationId,input.sourceDocumentId);
      if(race?.state==="posted") return {...race,created:false};
    }
    throw error;
  }

  return {
    id:documentId,number,state:"posted",sourceDocumentId:source.documentId,
    sourceDocumentNumber:source.documentNumber,bookingId:source.bookingId,reason,
    chargeAmount:source.chargeAmount,currency:source.currency,created:true,
  };
}

export async function listServiceCorrections(db:D1Database,organizationId:number,limit=200) {
  const safeLimit=Math.max(1,Math.min(500,Math.trunc(limit)));
  const rows=await db.prepare(
    `SELECT d.id,d.number,d.occurred_at AS occurredAt,d.state,d.posted_by AS postedBy,
            c.source_document_id AS sourceDocumentId,src.number AS sourceDocumentNumber,
            c.booking_id AS bookingId,b.code AS bookingCode,b.name AS patientName,
            c.reason,c.patient_id AS patientId,c.patient_category AS patientCategory,
            c.service_code AS serviceCode,c.service_title AS serviceTitle,c.equipment_id AS equipmentId,
            c.duration_minutes AS durationMinutes,c.anatomical_regions_count AS anatomicalRegionsCount,
            c.performed_at AS performedAt,c.radiologist_email AS radiologistEmail,
            c.radiographer_email AS radiographerEmail,c.charge_amount AS chargeAmount,c.currency
     FROM service_correction_details c
     JOIN business_documents d ON d.id=c.document_id AND d.organization_id=c.organization_id
     JOIN business_documents src ON src.id=c.source_document_id AND src.organization_id=c.organization_id
     JOIN bookings b ON b.id=c.booking_id AND b.organization_id=c.organization_id
     WHERE c.organization_id=?
     ORDER BY d.occurred_at DESC,d.id DESC LIMIT ${safeLimit}`
  ).bind(organizationId).all();
  return rows.results;
}
