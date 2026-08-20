from pathlib import Path

path = Path("lib/dicom.ts")
text = path.read_text()
old_imaging = '''export function sanitizeImagingStudy(input:unknown):ImagingValidation {
  if (!input || typeof input !== "object") return { ok:false, error:"Некоректні дані дослідження" };
  const raw = input as Record<string, unknown>;
  const accessionNumber = String(raw.accessionNumber ?? "").trim().slice(0, 64);
  const studyInstanceUid = String(raw.studyInstanceUid ?? "").trim().slice(0, 64);
  const modality = String(raw.modality ?? "").trim().toUpperCase().slice(0, 16);
  const studyDatetime = String(raw.studyDatetime ?? "").trim().slice(0, 25);
  const studyStatus = String(raw.studyStatus ?? "not_linked");
  if (!isValidAccession(accessionNumber)) return { ok:false, error:"Некоректний номер дослідження (Accession)" };
  if (studyInstanceUid && !isValidDicomUid(studyInstanceUid)) return { ok:false, error:"Некоректний StudyInstanceUID" };
  if (!(STUDY_STATUSES as string[]).includes(studyStatus)) return { ok:false, error:"Некоректний статус дослідження" };
  if ((studyStatus === "available" || studyStatus === "archived") && !studyInstanceUid) {
    return { ok:false, error:"Для доступного дослідження вкажіть StudyInstanceUID" };
  }
  return { ok:true, study:{ accessionNumber, studyInstanceUid, modality, studyStatus:studyStatus as StudyStatus, studyDatetime } };
}'''
new_imaging = '''export function sanitizeImagingStudy(input:unknown):ImagingValidation {
  if (!input || typeof input !== "object") return { ok:false, error:"Некоректні дані дослідження" };
  const raw = input as Record<string, unknown>;
  const accessionNumber = String(raw.accessionNumber ?? "").trim();
  const studyInstanceUid = String(raw.studyInstanceUid ?? "").trim();
  const modality = String(raw.modality ?? "").trim().toUpperCase();
  const studyDatetime = String(raw.studyDatetime ?? "").trim();
  const studyStatus = String(raw.studyStatus ?? "not_linked");
  if (accessionNumber.length > 64) return { ok:false, error:"AccessionNumber перевищує 64 символи" };
  if (studyInstanceUid.length > 64) return { ok:false, error:"StudyInstanceUID перевищує 64 символи" };
  if (modality.length > 16) return { ok:false, error:"Modality перевищує 16 символів" };
  if (studyDatetime.length > 25) return { ok:false, error:"Дата/час дослідження перевищує допустиму довжину" };
  if (!isValidAccession(accessionNumber)) return { ok:false, error:"Некоректний номер дослідження (Accession)" };
  if (studyInstanceUid && !isValidDicomUid(studyInstanceUid)) return { ok:false, error:"Некоректний StudyInstanceUID" };
  if (!(STUDY_STATUSES as string[]).includes(studyStatus)) return { ok:false, error:"Некоректний статус дослідження" };
  if ((studyStatus === "available" || studyStatus === "archived") && !studyInstanceUid) {
    return { ok:false, error:"Для доступного дослідження вкажіть StudyInstanceUID" };
  }
  return { ok:true, study:{ accessionNumber, studyInstanceUid, modality, studyStatus:studyStatus as StudyStatus, studyDatetime } };
}'''
old_pacs = '''export function sanitizePacsSettings(input:unknown):PacsSettingsValidation {
  if (!input || typeof input !== "object") return { ok:false, error:"Некоректні налаштування PACS" };
  const raw = input as Record<string, unknown>;
  const dicomwebBaseUrl = normalizeBaseUrl(String(raw.dicomwebBaseUrl ?? "")).slice(0, 400);
  const viewerBaseUrl = String(raw.viewerBaseUrl ?? "").trim().slice(0, 400);
  const aeTitle = String(raw.aeTitle ?? "").trim().slice(0, 16);
  const notes = String(raw.notes ?? "").trim().slice(0, 500);
  const enabled = raw.enabled === true || raw.enabled === 1 || raw.enabled === "true" ? 1 : 0;
  if (dicomwebBaseUrl && !isHttpUrl(dicomwebBaseUrl)) return { ok:false, error:"DICOMweb-адреса має бути http(s) URL" };
  if (viewerBaseUrl && !isHttpUrl(viewerBaseUrl.replace(/\\{study\\}/g, "0"))) return { ok:false, error:"Адреса переглядача має бути http(s) URL" };
  if (!isValidAeTitle(aeTitle)) return { ok:false, error:"AE Title — до 16 символів без керівних знаків" };
  if (enabled && !dicomwebBaseUrl) return { ok:false, error:"Щоб увімкнути PACS, вкажіть DICOMweb-адресу" };
  return { ok:true, settings:{ dicomwebBaseUrl, viewerBaseUrl, aeTitle, enabled, notes } };
}'''
new_pacs = '''export function sanitizePacsSettings(input:unknown):PacsSettingsValidation {
  if (!input || typeof input !== "object") return { ok:false, error:"Некоректні налаштування PACS" };
  const raw = input as Record<string, unknown>;
  const dicomwebBaseUrl = normalizeBaseUrl(String(raw.dicomwebBaseUrl ?? ""));
  const viewerBaseUrl = String(raw.viewerBaseUrl ?? "").trim();
  const aeTitle = String(raw.aeTitle ?? "").trim();
  const notes = String(raw.notes ?? "").trim();
  const enabled = raw.enabled === true || raw.enabled === 1 || raw.enabled === "true" ? 1 : 0;
  if (dicomwebBaseUrl.length > 400) return { ok:false, error:"DICOMweb-адреса перевищує 400 символів" };
  if (viewerBaseUrl.length > 400) return { ok:false, error:"Адреса переглядача перевищує 400 символів" };
  if (aeTitle.length > 16) return { ok:false, error:"AE Title — до 16 символів без керівних знаків" };
  if (notes.length > 500) return { ok:false, error:"Примітка PACS перевищує 500 символів" };
  if (dicomwebBaseUrl && !isHttpUrl(dicomwebBaseUrl)) return { ok:false, error:"DICOMweb-адреса має бути http(s) URL" };
  if (viewerBaseUrl && !isHttpUrl(viewerBaseUrl.replace(/\\{study\\}/g, "0"))) return { ok:false, error:"Адреса переглядача має бути http(s) URL" };
  if (!isValidAeTitle(aeTitle)) return { ok:false, error:"AE Title — до 16 символів без керівних знаків" };
  if (enabled && !dicomwebBaseUrl) return { ok:false, error:"Щоб увімкнути PACS, вкажіть DICOMweb-адресу" };
  return { ok:true, settings:{ dicomwebBaseUrl, viewerBaseUrl, aeTitle, enabled, notes } };
}'''
if old_imaging not in text:
    raise SystemExit("sanitizeImagingStudy block not found")
if old_pacs not in text:
    raise SystemExit("sanitizePacsSettings block not found")
text = text.replace(old_imaging, new_imaging).replace(old_pacs, new_pacs)
path.write_text(text)
