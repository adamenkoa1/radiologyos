// DICOM / PACS integration layer.
//
// Pure helpers validate DICOM identifiers, build DICOMweb (QIDO-RS / WADO-RS)
// URLs and parse DICOM JSON. Network calls stay in API routes so PACS outages
// remain best-effort and never become a clinical workflow dependency.

export type StudyStatus = "not_linked" | "scheduled" | "available" | "archived";

export type ImagingStudy = {
  bookingId:number;
  accessionNumber:string;
  studyInstanceUid:string;
  modality:string;
  seriesCount:number;
  instancesCount:number;
  studyStatus:StudyStatus;
  studyDatetime:string;
  source:string;
  updatedBy:string;
  updatedAt:string;
};

export type PacsSettings = {
  dicomwebBaseUrl:string;
  viewerBaseUrl:string;
  aeTitle:string;
  enabled:boolean;
  notes:string;
  updatedBy:string;
  updatedAt:string;
};

export type DicomSeries = {
  seriesInstanceUid:string;
  modality:string;
  seriesNumber:string;
  description:string;
  instances:number;
};

export type DicomStudyMatch = {
  accessionNumber:string;
  studyInstanceUid:string;
  patientId:string;
  modality:string;
  studyDatetime:string;
  seriesCount:number;
  instancesCount:number;
};

export type DicomAutoLinkCheck =
  | { ok:true }
  | { ok:false; reason:"missing_metadata" | "modality_mismatch" | "date_mismatch" };

export const STUDY_STATUSES:StudyStatus[] = ["not_linked", "scheduled", "available", "archived"];

export const STUDY_STATUS_LABELS:Record<StudyStatus,string> = {
  not_linked:"Не прив’язано",
  scheduled:"Заплановано",
  available:"Доступно в PACS",
  archived:"Архів",
};

// DICOM Application Entity title: up to 16 chars, no backslash/control chars.
export function isValidAeTitle(value:string):boolean {
  return value === "" || (/^[^\\\u0000-\u001f]{1,16}$/.test(value));
}

// DICOM UID: digits in dot-separated components, each without a leading zero
// (except the value "0"), total length up to 64.
export function isValidDicomUid(value:string):boolean {
  return /^(0|[1-9]\d*)(\.(0|[1-9]\d*))*$/.test(value) && value.length <= 64;
}

// Accession numbers are site-defined; accept a conservative safe subset.
export function isValidAccession(value:string):boolean {
  return value === "" || /^[A-Za-z0-9._-]{1,64}$/.test(value);
}

export function isHttpUrl(value:string):boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeBaseUrl(value:string):string {
  return value.trim().replace(/\/+$/, "");
}

// QIDO-RS: search studies by the DICOM AccessionNumber query key. Limit two is
// enough to distinguish an unambiguous match from a duplicate accession while
// still accepting servers that ignore the optional limit parameter.
export function qidoStudiesByAccessionUrl(base:string, accessionNumber:string):string {
  const query = new URLSearchParams({ AccessionNumber: accessionNumber, limit: "2" });
  return `${normalizeBaseUrl(base)}/studies?${query.toString()}`;
}

// QIDO-RS: resolve a manually supplied StudyInstanceUID independently of any
// client-provided AccessionNumber. The caller still verifies the returned UID.
export function qidoStudiesByUidUrl(base:string, studyInstanceUid:string):string {
  const query = new URLSearchParams({ StudyInstanceUID: studyInstanceUid, limit: "2" });
  return `${normalizeBaseUrl(base)}/studies?${query.toString()}`;
}

// QIDO-RS: list the series of a study.
export function qidoSeriesUrl(base:string, studyInstanceUid:string):string {
  return `${normalizeBaseUrl(base)}/studies/${encodeURIComponent(studyInstanceUid)}/series`;
}

// WADO-RS: retrieve the whole study.
export function wadoStudyUrl(base:string, studyInstanceUid:string):string {
  return `${normalizeBaseUrl(base)}/studies/${encodeURIComponent(studyInstanceUid)}`;
}

// Build a viewer deep-link. Supports a `{study}` placeholder or the common
// OHIF `?StudyInstanceUIDs=` convention.
export function viewerUrl(viewerBase:string, studyInstanceUid:string):string {
  const base = viewerBase.trim();
  if (!base || !studyInstanceUid) return "";
  if (base.includes("{study}")) return base.replace(/\{study\}/g, encodeURIComponent(studyInstanceUid));
  return `${base}${base.includes("?") ? "&" : "?"}StudyInstanceUIDs=${encodeURIComponent(studyInstanceUid)}`;
}

function dicomValues(row:Record<string, unknown>, tag:string):string[] {
  const element = row[tag] as { Value?:unknown[] } | undefined;
  if (!Array.isArray(element?.Value)) return [];
  return element.Value.map((value) => {
    if (value == null) return "";
    if (typeof value === "object") {
      const alphabetic = (value as { Alphabetic?:string }).Alphabetic;
      return alphabetic ? String(alphabetic) : "";
    }
    return String(value);
  }).filter(Boolean);
}

function dicomValue(row:Record<string, unknown>, tag:string):string {
  return dicomValues(row, tag)[0] || "";
}

function dicomStudyDatetime(row:Record<string, unknown>):string {
  const date = dicomValue(row, "00080020");
  const time = dicomValue(row, "00080030");
  if (!/^\d{8}$/.test(date)) return "";
  const isoDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  if (!time) return isoDate;
  const compact = time.split(".")[0].replace(/[^0-9]/g, "").padEnd(6, "0").slice(0, 6);
  return `${isoDate}T${compact.slice(0, 2)}:${compact.slice(2, 4)}:${compact.slice(4, 6)}`;
}

// Parse QIDO-RS study search results. Rows without a valid StudyInstanceUID are
// ignored so callers can never persist a malformed DICOM link.
export function parseQidoStudies(payload:unknown):DicomStudyMatch[] {
  if (!Array.isArray(payload)) return [];
  return payload.map((entry) => {
    const row = (entry && typeof entry === "object") ? entry as Record<string, unknown> : {};
    const modalities = dicomValues(row, "00080061");
    return {
      accessionNumber:dicomValue(row, "00080050"),
      studyInstanceUid:dicomValue(row, "0020000D"),
      patientId:dicomValue(row, "00100020"),
      modality:(modalities[0] || dicomValue(row, "00080060")).toUpperCase(),
      studyDatetime:dicomStudyDatetime(row),
      seriesCount:Number(dicomValue(row, "00201206")) || 0,
      instancesCount:Number(dicomValue(row, "00201208")) || 0,
    };
  }).filter((study) => isValidDicomUid(study.studyInstanceUid));
}

// Accession Number is necessary but not sufficient for unattended linking.
// Require the standard QIDO study date and modality to agree with the booking.
// DX accepts CR because some radiography systems report computed radiography
// even when the local worklist uses the DX modality family.
export function checkDicomAutoLinkMatch(
  study:DicomStudyMatch,
  expectedModality:string,
  expectedDate:string,
):DicomAutoLinkCheck {
  const modality = study.modality.trim().toUpperCase();
  const studyDate = /^\d{4}-\d{2}-\d{2}/.exec(study.studyDatetime)?.[0] || "";
  const normalizedExpectedModality = expectedModality.trim().toUpperCase();
  if (!modality || !studyDate || !normalizedExpectedModality || !/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) {
    return { ok:false, reason:"missing_metadata" };
  }
  const modalityMatches = normalizedExpectedModality === "DX"
    ? modality === "DX" || modality === "CR"
    : modality === normalizedExpectedModality;
  if (!modalityMatches) return { ok:false, reason:"modality_mismatch" };
  if (studyDate !== expectedDate) return { ok:false, reason:"date_mismatch" };
  return { ok:true };
}

// Parse a QIDO-RS "application/dicom+json" series response into plain objects.
// Invalid SeriesInstanceUID rows are ignored so malformed PACS data never
// reaches the client-side study/series model.
export function parseQidoSeries(payload:unknown):DicomSeries[] {
  if (!Array.isArray(payload)) return [];
  return payload.map((entry) => {
    const row = (entry && typeof entry === "object") ? entry as Record<string, unknown> : {};
    return {
      seriesInstanceUid:dicomValue(row, "0020000E"),
      modality:dicomValue(row, "00080060"),
      seriesNumber:dicomValue(row, "00200011"),
      description:dicomValue(row, "0008103E"),
      instances:Number(dicomValue(row, "00201209")) || 0,
    };
  }).filter((series) => isValidDicomUid(series.seriesInstanceUid));
}

export type ImagingValidation =
  | { ok:true; study:{ accessionNumber:string; studyInstanceUid:string; modality:string; studyStatus:StudyStatus; studyDatetime:string } }
  | { ok:false; error:string };

export function sanitizeImagingStudy(input:unknown):ImagingValidation {
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
}

export type PacsSettingsValidation =
  | { ok:true; settings:{ dicomwebBaseUrl:string; viewerBaseUrl:string; aeTitle:string; enabled:number; notes:string } }
  | { ok:false; error:string };

export function sanitizePacsSettings(input:unknown):PacsSettingsValidation {
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
  if (viewerBaseUrl && !isHttpUrl(viewerBaseUrl.replace(/\{study\}/g, "0"))) return { ok:false, error:"Адреса переглядача має бути http(s) URL" };
  if (!isValidAeTitle(aeTitle)) return { ok:false, error:"AE Title — до 16 символів без керівних знаків" };
  if (enabled && !dicomwebBaseUrl) return { ok:false, error:"Щоб увімкнути PACS, вкажіть DICOMweb-адресу" };
  return { ok:true, settings:{ dicomwebBaseUrl, viewerBaseUrl, aeTitle, enabled, notes } };
}
