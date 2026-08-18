export type BusinessJournalDocument={
  id:number;documentType:string;journalType:string;number:string;occurredAt:string;state:string;comment:string;
  createdBy:string;createdAt:string;postedBy:string;postedAt:string;reversedDocumentId:number|null;basisDocumentId:number|null;
  bookingId:number|null;bookingCode:string;patientName:string;patientId:string;subject:string;
  amount:number;currency:string;sourceDocumentId:number|null;relationType:string;lineCount:number;totalQuantity:number;
};

function safeLimit(value:number,defaultValue=250) {
  const n=Number.isFinite(value)?Math.trunc(value):defaultValue;
  return Math.max(1,Math.min(500,n));
}

const SUMMARY_SELECT=`
  SELECT d.id,d.document_type AS documentType,
         CASE WHEN rad.document_id IS NOT NULL THEN 'result_addendum_delivery' WHEN c.document_id IS NOT NULL THEN 'service_correction' ELSE d.document_type END AS journalType,
         d.number,d.occurred_at AS occurredAt,d.state,d.comment,d.created_by AS createdBy,
         d.created_at AS createdAt,d.posted_by AS postedBy,d.posted_at AS postedAt,
         d.reversed_document_id AS reversedDocumentId,d.basis_document_id AS basisDocumentId,
         COALESCE(o.booking_id,a.booking_id,s.booking_id,sp.booking_id,sc.booking_id,rd.booking_id,rad.booking_id,c.booking_id,f.booking_id) AS bookingId,
         COALESCE(b.code,'') AS bookingCode,COALESCE(b.name,'') AS patientName,
         COALESCE(o.patient_id,a.patient_id,s.patient_id,sp.patient_id,sc.patient_id,rd.patient_id,rad.patient_id,c.patient_id,f.patient_id,'') AS patientId,
         COALESCE(o.service_title,a.service_title,s.service_title,sp.service_title,sc.service_title,rd.service_title,rad.service_title,c.service_title,b.service,'') AS subject,
         COALESCE(o.charge_amount,s.charge_amount,c.charge_amount,f.amount,0) AS amount,
         COALESCE(o.currency,s.currency,c.currency,f.currency,'UAH') AS currency,
         COALESCE(
           d.basis_document_id,
           CASE
             WHEN c.document_id IS NOT NULL THEN c.source_document_id
             WHEN f.source_document_id IS NOT NULL THEN f.source_document_id
             WHEN d.reversed_document_id IS NOT NULL THEN d.reversed_document_id
             ELSE NULL
           END
         ) AS sourceDocumentId,
         CASE
           WHEN c.document_id IS NOT NULL THEN 'storno_of'
           WHEN d.document_type='refund' AND f.source_document_id IS NOT NULL THEN 'refund_of'
           WHEN d.basis_document_id IS NOT NULL THEN 'based_on'
           WHEN d.reversed_document_id IS NOT NULL THEN 'reversal_of'
           ELSE ''
         END AS relationType,
         (SELECT COUNT(*) FROM inventory_document_lines il
          WHERE il.organization_id=d.organization_id AND il.document_id=d.id) AS lineCount,
         COALESCE((SELECT SUM(il.quantity) FROM inventory_document_lines il
          WHERE il.organization_id=d.organization_id AND il.document_id=d.id),0) AS totalQuantity
  FROM business_documents d
  LEFT JOIN patient_order_details o
    ON o.document_id=d.id AND o.organization_id=d.organization_id
  LEFT JOIN appointment_details a
    ON a.document_id=d.id AND a.organization_id=d.organization_id
  LEFT JOIN service_delivery_details s
    ON s.document_id=d.id AND s.organization_id=d.organization_id
  LEFT JOIN service_delivery_details sp
    ON d.document_type='study_performance'
   AND sp.document_id=d.basis_document_id
   AND sp.organization_id=d.organization_id
  LEFT JOIN business_documents scp
    ON d.document_type='study_correction'
   AND scp.id=d.basis_document_id
   AND scp.organization_id=d.organization_id
   AND scp.document_type='study_performance'
  LEFT JOIN service_delivery_details sc
    ON d.document_type='study_correction'
   AND sc.document_id=scp.basis_document_id
   AND sc.organization_id=d.organization_id
  LEFT JOIN result_delivery_details rd
    ON rd.document_id=d.id AND rd.organization_id=d.organization_id
  LEFT JOIN result_addendum_delivery_details rad
    ON rad.document_id=d.id AND rad.organization_id=d.organization_id
  LEFT JOIN service_correction_details c
    ON c.document_id=d.id AND c.organization_id=d.organization_id
  LEFT JOIN finance_document_details f
    ON f.document_id=d.id AND f.organization_id=d.organization_id
  LEFT JOIN bookings b
    ON b.organization_id=d.organization_id
   AND b.id=COALESCE(o.booking_id,a.booking_id,s.booking_id,sp.booking_id,sc.booking_id,rd.booking_id,rad.booking_id,c.booking_id,f.booking_id)`;

export async function listBusinessDocuments(db:D1Database,organizationId:number,limit=250) {
  const rows=await db.prepare(
    `${SUMMARY_SELECT}
     WHERE d.organization_id=?
     ORDER BY d.occurred_at DESC,d.id DESC
     LIMIT ${safeLimit(limit)}`
  ).bind(organizationId).all<BusinessJournalDocument>();
  return rows.results;
}

export async function getBusinessDocumentSummary(db:D1Database,organizationId:number,documentId:number) {
  const row=await db.prepare(
    `${SUMMARY_SELECT}
     WHERE d.organization_id=? AND d.id=?
     LIMIT 1`
  ).bind(organizationId,documentId).first<BusinessJournalDocument>();
  return row || null;
}

type RelatedDocument={
  id:number;documentType:string;journalType:string;number:string;occurredAt:string;state:string;
  relationType:string;
};

export async function getBusinessDocumentRelations(db:D1Database,organizationId:number,document:BusinessJournalDocument) {
  const parent:RelatedDocument[]=[];
  if(document.sourceDocumentId) {
    const source=await db.prepare(
      `SELECT d.id,d.document_type AS documentType,
              CASE WHEN rad.document_id IS NOT NULL THEN 'result_addendum_delivery' WHEN c.document_id IS NOT NULL THEN 'service_correction' ELSE d.document_type END AS journalType,
              d.number,d.occurred_at AS occurredAt,d.state,? AS relationType
       FROM business_documents d
       LEFT JOIN service_correction_details c
         ON c.document_id=d.id AND c.organization_id=d.organization_id
       LEFT JOIN result_addendum_delivery_details rad
         ON rad.document_id=d.id AND rad.organization_id=d.organization_id
       WHERE d.organization_id=? AND d.id=? LIMIT 1`
    ).bind(document.relationType || "source",organizationId,document.sourceDocumentId).first<RelatedDocument>();
    if(source) parent.push(source);
  }

  const children=await db.prepare(
    `SELECT d.id,d.document_type AS documentType,
            CASE WHEN rad.document_id IS NOT NULL THEN 'result_addendum_delivery' WHEN c.document_id IS NOT NULL THEN 'service_correction' ELSE d.document_type END AS journalType,
            d.number,d.occurred_at AS occurredAt,d.state,
            CASE
              WHEN c.source_document_id=? THEN 'storno'
              WHEN d.document_type='refund' AND f.source_document_id=? THEN 'refund'
              WHEN d.basis_document_id=? THEN 'based_on'
              WHEN d.reversed_document_id=? THEN 'reversal'
              ELSE 'related'
            END AS relationType
     FROM business_documents d
     LEFT JOIN service_correction_details c
       ON c.document_id=d.id AND c.organization_id=d.organization_id
     LEFT JOIN result_addendum_delivery_details rad
       ON rad.document_id=d.id AND rad.organization_id=d.organization_id
     LEFT JOIN finance_document_details f
       ON f.document_id=d.id AND f.organization_id=d.organization_id
     WHERE d.organization_id=? AND d.id<>?
       AND (d.basis_document_id=? OR c.source_document_id=? OR f.source_document_id=? OR d.reversed_document_id=?)
     ORDER BY d.occurred_at,d.id`
  ).bind(
    document.id,document.id,document.id,document.id,
    organizationId,document.id,document.id,document.id,document.id,document.id,
  ).all<RelatedDocument>();
  return {parent,children:children.results};
}

export async function getBusinessDocumentMovements(db:D1Database,organizationId:number,documentId:number) {
  const [cash,settlement,revenue,services,corrections,equipment,staff,inventory]=await Promise.all([
    db.prepare(
      `SELECT id,movement_type AS movementType,amount_delta AS amountDelta,currency,method,provider,
              provider_reference AS providerReference,actor_email AS actorEmail,occurred_at AS occurredAt
       FROM cash_movements WHERE organization_id=? AND document_id=? ORDER BY id`
    ).bind(organizationId,documentId).all(),
    db.prepare(
      `SELECT id,movement_type AS movementType,amount_delta AS amountDelta,currency,
              actor_email AS actorEmail,occurred_at AS occurredAt
       FROM patient_settlement_movements WHERE organization_id=? AND document_id=? ORDER BY id`
    ).bind(organizationId,documentId).all(),
    db.prepare(
      `SELECT id,movement_type AS movementType,amount_delta AS amountDelta,currency,service_code AS serviceCode,
              actor_email AS actorEmail,occurred_at AS occurredAt
       FROM revenue_movements WHERE organization_id=? AND document_id=? ORDER BY id`
    ).bind(organizationId,documentId).all(),
    db.prepare(
      `SELECT id,quantity,anatomical_regions_count AS anatomicalRegionsCount,service_code AS serviceCode,
              equipment_id AS equipmentId,performed_at AS performedAt,actor_email AS actorEmail,occurred_at AS occurredAt
       FROM services_delivered_movements WHERE organization_id=? AND document_id=? ORDER BY id`
    ).bind(organizationId,documentId).all(),
    db.prepare(
      `SELECT id,source_document_id AS sourceDocumentId,quantity_delta AS quantityDelta,
              anatomical_regions_delta AS anatomicalRegionsDelta,service_code AS serviceCode,equipment_id AS equipmentId,
              reason,actor_email AS actorEmail,occurred_at AS occurredAt
       FROM service_correction_movements WHERE organization_id=? AND document_id=? ORDER BY id`
    ).bind(organizationId,documentId).all(),
    db.prepare(
      `SELECT id,minutes_delta AS minutesDelta,equipment_id AS equipmentId,performed_at AS performedAt,
              actor_email AS actorEmail,occurred_at AS occurredAt
       FROM equipment_load_movements WHERE organization_id=? AND document_id=? ORDER BY id`
    ).bind(organizationId,documentId).all(),
    db.prepare(
      `SELECT id,member_email AS memberEmail,staff_role AS staffRole,units_delta AS unitsDelta,
              anatomical_regions_count AS anatomicalRegionsCount,performed_at AS performedAt,
              actor_email AS actorEmail,occurred_at AS occurredAt
       FROM staff_output_movements WHERE organization_id=? AND document_id=? ORDER BY id`
    ).bind(organizationId,documentId).all(),
    db.prepare(
      `SELECT m.id,m.movement_type AS movementType,m.quantity_delta AS quantityDelta,m.item_id AS itemId,
              i.name AS itemName,m.lot_id AS lotId,l.lot_number AS lotNumber,m.reason,m.booking_id AS bookingId,
              m.actor_email AS actorEmail,m.created_at AS occurredAt
       FROM inventory_movements m
       JOIN inventory_items i ON i.id=m.item_id AND i.organization_id=m.organization_id
       JOIN inventory_lots l ON l.id=m.lot_id AND l.organization_id=m.organization_id
       WHERE m.organization_id=? AND m.document_id=? ORDER BY m.id`
    ).bind(organizationId,documentId).all(),
  ]);
  return {
    cash:cash.results,
    settlement:settlement.results,
    revenue:revenue.results,
    services:services.results,
    corrections:corrections.results,
    equipment:equipment.results,
    staff:staff.results,
    inventory:inventory.results,
  };
}

export async function getBusinessDocumentPrintedForms(db:D1Database,organizationId:number,documentId:number) {
  const rows=await db.prepare(
    `SELECT id,form_type AS formType,template_version AS templateVersion,document_state AS documentState,
            generated_by AS generatedBy,generated_at AS generatedAt,storage_key AS storageKey,sha256
     FROM printed_form_snapshots
     WHERE organization_id=? AND document_id=?
     ORDER BY generated_at DESC,id DESC`
  ).bind(organizationId,documentId).all();
  return rows.results;
}

export async function getBusinessDocumentJournalDetail(db:D1Database,organizationId:number,documentId:number) {
  const document=await getBusinessDocumentSummary(db,organizationId,documentId);
  if(!document) return null;
  const [relations,movements,printedForms]=await Promise.all([
    getBusinessDocumentRelations(db,organizationId,document),
    getBusinessDocumentMovements(db,organizationId,documentId),
    getBusinessDocumentPrintedForms(db,organizationId,documentId),
  ]);
  return {document,relations,movements,printedForms};
}
