from pathlib import Path

path = Path("app/api/staff/imaging/route.ts")
text = path.read_text()
start = text.index("async function checkPacsPatientIdentity(")
end = text.index("\n\nasync function qidoStudies", start)
replacement = '''async function checkPacsPatientIdentity(
  db:D1Database,
  organizationId:number,
  booking:ImagingBooking,
  study:DicomStudyMatch,
):Promise<{ ok:true } | { ok:false; reason:"patient_id_missing" | "patient_id_mismatch" | "patient_identity_unverified" }> {
  // Once immutable MWL identity exists it is authoritative even when PACS
  // reports the canonical RadiologyOS accession. Accession-only acceptance is
  // retained solely for historical studies that predate MWL PatientID binding.
  const expectedPatientId = await expectedMwlPatientId(db, organizationId, booking);
  if (expectedPatientId) {
    if (!study.patientId) return { ok:false, reason:"patient_id_missing" };
    if (study.patientId !== expectedPatientId) return { ok:false, reason:"patient_id_mismatch" };
    return { ok:true };
  }

  if (study.accessionNumber === booking.code) return { ok:true };
  return { ok:false, reason:"patient_identity_unverified" };
}'''
text = text[:start] + replacement + text[end:]
path.write_text(text)
