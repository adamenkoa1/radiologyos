import assert from "node:assert/strict";
import test from "node:test";
import {
  BUSINESS_CORE_LAYERS,
  DOCUMENT_REGISTER_MAP,
  DOCUMENT_STATES,
  DOCUMENT_TYPES,
  PRINTED_FORM_TYPES,
  RADIOLOGYOS_ARCHITECTURE,
  REFERENCE_TYPES,
  REGISTER_TYPES,
  SYSTEM_LAYERS,
  canMutateBusinessFacts,
  canTransitionDocument,
  registersForDocument,
  requiresCorrectionDocument,
} from "../lib/business-core.ts";

test("business core preserves BAS-style layer order", () => {
  assert.deepEqual([...BUSINESS_CORE_LAYERS], [
    "reference",
    "document",
    "posting",
    "register",
    "report",
  ]);
});

test("RadiologyOS keeps business core, medical layer and public site as explicit boundaries", () => {
  assert.deepEqual([...SYSTEM_LAYERS], ["business_core", "medical", "public_site"]);
  assert.equal(RADIOLOGYOS_ARCHITECTURE.businessCore.layer, "business_core");
  assert.equal(RADIOLOGYOS_ARCHITECTURE.medical.dependsOn, "business_core");
  assert.equal(RADIOLOGYOS_ARCHITECTURE.publicSite.layer, "public_site");
  assert.equal(RADIOLOGYOS_ARCHITECTURE.publicSite.economicFactOwner, false);
  assert.ok(RADIOLOGYOS_ARCHITECTURE.publicSite.exposes.includes("booking_intake"));
  assert.ok(RADIOLOGYOS_ARCHITECTURE.publicSite.exposes.includes("payment_initiation"));
});

test("clinic business model exposes canonical references and documents", () => {
  for (const required of ["patient", "service", "employee", "equipment", "inventory_item", "counterparty"]) {
    assert.ok(REFERENCE_TYPES.includes(required), required);
  }
  for (const required of ["patient_order", "service_delivery", "payment", "refund", "inventory_writeoff", "study_performance", "result_delivery"]) {
    assert.ok(DOCUMENT_TYPES.includes(required), required);
  }
  assert.equal(DOCUMENT_TYPES.includes("imaging_study"), false, "DICOM ImagingStudy must not be reused as a business document type");
});

test("posted documents cannot be silently edited or cancelled", () => {
  assert.deepEqual([...DOCUMENT_STATES], ["draft", "posted", "reversed", "cancelled"]);
  assert.equal(canTransitionDocument("draft", "posted"), true);
  assert.equal(canTransitionDocument("draft", "cancelled"), true);
  assert.equal(canTransitionDocument("posted", "cancelled"), false);
  assert.equal(canTransitionDocument("posted", "draft"), false);
  assert.equal(canTransitionDocument("posted", "reversed"), true);
  assert.equal(canTransitionDocument("reversed", "posted"), false);
  assert.equal(canMutateBusinessFacts("draft"), true);
  assert.equal(canMutateBusinessFacts("posted"), false);
  assert.equal(requiresCorrectionDocument("posted"), true);
});

test("posting maps business documents to registers", () => {
  assert.deepEqual(registersForDocument("payment"), ["cash", "patient_settlements", "receivables"]);
  assert.deepEqual(registersForDocument("refund"), ["cash", "patient_settlements", "receivables"]);
  assert.equal(registersForDocument("refund").includes("revenue"), false, "money refund alone must not rewrite revenue");
  assert.ok(registersForDocument("service_delivery").includes("revenue"));
  assert.ok(registersForDocument("service_delivery").includes("receivables"));
  assert.ok(registersForDocument("service_delivery").includes("equipment_load"));
  assert.ok(registersForDocument("inventory_writeoff").includes("inventory_balance"));
  assert.ok(registersForDocument("study_performance").includes("studies_performed"));
  for (const registers of Object.values(DOCUMENT_REGISTER_MAP)) {
    for (const register of registers || []) assert.ok(REGISTER_TYPES.includes(register), register);
  }
});

test("printed forms are first-class business-core objects", () => {
  for (const form of ["invoice", "payment_receipt", "service_act", "referral", "protocol", "result", "inventory_writeoff"]) {
    assert.ok(PRINTED_FORM_TYPES.includes(form), form);
  }
});