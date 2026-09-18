import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeImagingStudy, sanitizePacsSettings } from "../lib/dicom.ts";

// Exact boundaries remain accepted; only over-limit values fail closed.
test("DICOM identity inputs fail closed instead of being silently truncated", () => {
  const overlongAccession = "A".repeat(65);
  const accession = sanitizeImagingStudy({
    accessionNumber: overlongAccession,
    studyStatus: "scheduled",
  });
  assert.equal(accession.ok, false);
  assert.match(accession.error, /64/);

  // 65 chars and syntactically valid if the old sanitizer silently removed the
  // last character. That truncation would create a different valid study UID.
  const overlongUid = `1.${"2".repeat(63)}`;
  assert.equal(overlongUid.length, 65);
  const uid = sanitizeImagingStudy({
    accessionNumber: "DICOM-BOUNDS-1",
    studyInstanceUid: overlongUid,
    modality: "CT",
    studyDatetime: "2026-08-20T10:30:00",
    studyStatus: "available",
  });
  assert.equal(uid.ok, false);
  assert.match(uid.error, /64/);

  const exactUid = `1.${"2".repeat(62)}`;
  assert.equal(exactUid.length, 64);
  const exact = sanitizeImagingStudy({
    accessionNumber: "DICOM-BOUNDS-1",
    studyInstanceUid: exactUid,
    modality: "CT",
    studyDatetime: "2026-08-20T10:30:00",
    studyStatus: "available",
  });
  assert.equal(exact.ok, true);
  assert.equal(exact.study.studyInstanceUid, exactUid);
});

test("DICOM metadata bounds fail closed instead of truncating modality or datetime", () => {
  const modality = sanitizeImagingStudy({
    accessionNumber: "DICOM-BOUNDS-2",
    modality: "X".repeat(17),
    studyStatus: "scheduled",
  });
  assert.equal(modality.ok, false);
  assert.match(modality.error, /16/);

  const datetime = sanitizeImagingStudy({
    accessionNumber: "DICOM-BOUNDS-3",
    studyDatetime: "2".repeat(26),
    studyStatus: "scheduled",
  });
  assert.equal(datetime.ok, false);
  assert.match(datetime.error, /довжину/i);
});

test("PACS configuration fails closed instead of silently changing endpoints or identifiers", () => {
  const overlongDicomweb = sanitizePacsSettings({
    dicomwebBaseUrl: `https://pacs.example.com/${"a".repeat(390)}`,
    viewerBaseUrl: "https://viewer.example.com",
    aeTitle: "RADTEST",
    enabled: true,
  });
  assert.equal(overlongDicomweb.ok, false);
  assert.match(overlongDicomweb.error, /400/);

  const overlongViewer = sanitizePacsSettings({
    dicomwebBaseUrl: "https://pacs.example.com/dicom-web",
    viewerBaseUrl: `https://viewer.example.com/${"b".repeat(390)}`,
    aeTitle: "RADTEST",
    enabled: true,
  });
  assert.equal(overlongViewer.ok, false);
  assert.match(overlongViewer.error, /400/);

  const overlongAe = sanitizePacsSettings({
    dicomwebBaseUrl: "https://pacs.example.com/dicom-web",
    viewerBaseUrl: "https://viewer.example.com",
    aeTitle: "ABCDEFGHIJKLMNOPQ",
    enabled: true,
  });
  assert.equal(overlongAe.ok, false);
  assert.match(overlongAe.error, /16/);

  const overlongNotes = sanitizePacsSettings({
    dicomwebBaseUrl: "https://pacs.example.com/dicom-web",
    viewerBaseUrl: "https://viewer.example.com",
    aeTitle: "RADTEST",
    notes: "n".repeat(501),
    enabled: true,
  });
  assert.equal(overlongNotes.ok, false);
  assert.match(overlongNotes.error, /500/);
});
