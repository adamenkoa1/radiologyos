-- Service-delivery acts are immutable printed snapshots of the posted economic document.
-- One canonical snapshot is kept for each document state/template version; reprints reuse it.
CREATE UNIQUE INDEX IF NOT EXISTS `printed_service_act_state_unique`
  ON `printed_form_snapshots` (`organization_id`,`document_id`,`form_type`,`template_version`,`document_state`)
  WHERE `form_type`='service_act' AND `document_state` IN ('posted','reversed');
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `printed_service_act_snapshot_integrity`
BEFORE INSERT ON `printed_form_snapshots`
WHEN NEW.form_type='service_act'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM `business_documents` d
    JOIN `service_delivery_details` s
      ON s.document_id=d.id AND s.organization_id=d.organization_id
    JOIN `bookings` b
      ON b.id=s.booking_id AND b.organization_id=s.organization_id
    LEFT JOIN `organizations` o ON o.id=d.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.document_type='service_delivery'
      AND d.state=NEW.document_state
      AND d.state IN ('posted','reversed')
      AND CAST(json_extract(NEW.payload_json,'$.templateVersion') AS INTEGER)=NEW.template_version
      AND json_extract(NEW.payload_json,'$.formType')='service_act'
      AND CAST(json_extract(NEW.payload_json,'$.document.id') AS INTEGER)=d.id
      AND json_extract(NEW.payload_json,'$.document.number')=d.number
      AND json_extract(NEW.payload_json,'$.document.state')=d.state
      AND CAST(json_extract(NEW.payload_json,'$.booking.id') AS INTEGER)=s.booking_id
      AND json_extract(NEW.payload_json,'$.booking.code')=b.code
      AND json_extract(NEW.payload_json,'$.booking.patientName')=b.name
      AND json_extract(NEW.payload_json,'$.booking.patientId')=s.patient_id
      AND json_extract(NEW.payload_json,'$.booking.patientCategory')=s.patient_category
      AND json_extract(NEW.payload_json,'$.service.code')=s.service_code
      AND json_extract(NEW.payload_json,'$.service.title')=s.service_title
      AND json_extract(NEW.payload_json,'$.service.equipmentId')=s.equipment_id
      AND CAST(json_extract(NEW.payload_json,'$.service.durationMinutes') AS INTEGER)=s.duration_minutes
      AND CAST(json_extract(NEW.payload_json,'$.service.anatomicalRegionsCount') AS INTEGER)=s.anatomical_regions_count
      AND json_extract(NEW.payload_json,'$.service.performedAt')=s.performed_at
      AND json_extract(NEW.payload_json,'$.service.radiologistEmail')=s.radiologist_email
      AND json_extract(NEW.payload_json,'$.service.radiographerEmail')=s.radiographer_email
      AND CAST(json_extract(NEW.payload_json,'$.service.priceAmount') AS INTEGER)=s.price_amount
      AND CAST(json_extract(NEW.payload_json,'$.service.chargeAmount') AS INTEGER)=s.charge_amount
      AND json_extract(NEW.payload_json,'$.service.currency')=s.currency
      AND json_extract(NEW.payload_json,'$.organization.name')=COALESCE(o.name,'Організація')
  ) THEN RAISE(ABORT,'printed_service_act_document_mismatch') END;
END;
