export const SYSTEM_LAYERS = ["business_core", "medical", "public_site"] as const;
export type SystemLayer = typeof SYSTEM_LAYERS[number];

// Canonical product boundary:
// BAS Small Company = business_core.
// RadiologyOS = business_core + medical.
// Public site = external storefront/intake channel and never the owner of posted economic facts.
export const RADIOLOGYOS_ARCHITECTURE = {
  businessCore: {
    layer: "business_core" as const,
    owns: ["references", "documents", "posting", "registers", "reports", "printed_forms"] as const,
  },
  medical: {
    layer: "medical" as const,
    dependsOn: "business_core" as const,
    owns: ["clinical_workflow", "dicom_pacs", "protocols", "results", "medical_access_control"] as const,
  },
  publicSite: {
    layer: "public_site" as const,
    exposes: ["storefront", "catalog", "booking_intake", "payment_initiation", "patient_entry"] as const,
    economicFactOwner: false as const,
  },
} as const;

export const BUSINESS_CORE_LAYERS = [
  "reference",
  "document",
  "posting",
  "register",
  "report",
] as const;

export type BusinessCoreLayer = typeof BUSINESS_CORE_LAYERS[number];

export const REFERENCE_TYPES = [
  "patient",
  "service",
  "employee",
  "department",
  "room",
  "equipment",
  "inventory_item",
  "counterparty",
  "price_list",
  "cash_account",
] as const;

export type ReferenceType = typeof REFERENCE_TYPES[number];

export const DOCUMENT_TYPES = [
  "patient_order",
  "appointment",
  "service_delivery",
  "payment",
  "refund",
  "inventory_receipt",
  "inventory_writeoff",
  "inventory_transfer",
  "inventory_count",
  "study_performance",
  "result_delivery",
] as const;

export type DocumentType = typeof DOCUMENT_TYPES[number];

export const DOCUMENT_STATES = ["draft", "posted", "reversed", "cancelled"] as const;
export type DocumentState = typeof DOCUMENT_STATES[number];

export const DOCUMENT_TRANSITIONS: Readonly<Record<DocumentState, readonly DocumentState[]>> = {
  draft: ["posted", "cancelled"],
  posted: ["reversed"],
  reversed: [],
  cancelled: [],
};

export const REGISTER_TYPES = [
  "patient_settlements",
  "cash",
  "revenue",
  "expenses",
  "inventory_balance",
  "inventory_reservations",
  "services_delivered",
  "equipment_load",
  "staff_output",
  "studies_performed",
  "receivables",
] as const;

export type RegisterType = typeof REGISTER_TYPES[number];

export const PRINTED_FORM_TYPES = [
  "invoice",
  "payment_receipt",
  "service_act",
  "referral",
  "protocol",
  "result",
  "inventory_receipt",
  "inventory_writeoff",
  "inventory_transfer",
  "inventory_count",
  "service_note",
] as const;

export type PrintedFormType = typeof PRINTED_FORM_TYPES[number];

export type BusinessDocument = {
  id: string;
  organizationId: number;
  type: DocumentType;
  number: string;
  occurredAt: string;
  state: DocumentState;
  createdBy: string;
  createdAt: string;
  postedBy?: string;
  postedAt?: string;
  reversedDocumentId?: string;
};

export type RegisterMovement = {
  id: string;
  organizationId: number;
  register: RegisterType;
  documentId: string;
  occurredAt: string;
  dimensions: Record<string, string | number>;
  resources: Record<string, number>;
};

export type PrintedFormDefinition = {
  id: string;
  organizationId: number;
  formType: PrintedFormType;
  documentType: DocumentType;
  templateVersion: number;
  title: string;
  active: boolean;
};

export type PrintedFormSnapshot = {
  id: string;
  organizationId: number;
  documentId: string;
  formDefinitionId: string;
  templateVersion: number;
  generatedAt: string;
  generatedBy: string;
  storageKey: string;
  sha256: string;
};

export function isDocumentState(value: unknown): value is DocumentState {
  return typeof value === "string" && DOCUMENT_STATES.includes(value as DocumentState);
}

export function canTransitionDocument(from: unknown, to: unknown): boolean {
  if (!isDocumentState(from) || !isDocumentState(to)) return false;
  if (from === to) return true;
  return DOCUMENT_TRANSITIONS[from].includes(to);
}

export function canMutateBusinessFacts(state: DocumentState): boolean {
  return state === "draft";
}

export function requiresCorrectionDocument(state: DocumentState): boolean {
  return state === "posted" || state === "reversed";
}

export const DOCUMENT_REGISTER_MAP: Readonly<Partial<Record<DocumentType, readonly RegisterType[]>>> = {
  // The medical execution event is the source fact; the posted service act owns only economic/operational
  // business movements. We deliberately do not create a second "performed study" truth in this posting.
  service_delivery: ["revenue", "patient_settlements", "equipment_load", "staff_output"],
  payment: ["cash", "patient_settlements"],
  // A money refund reverses cash/settlement only. Revenue is corrected by a service correction/storno,
  // not merely because money was returned.
  refund: ["cash", "patient_settlements"],
  inventory_receipt: ["inventory_balance"],
  inventory_writeoff: ["inventory_balance", "expenses"],
  inventory_transfer: ["inventory_balance"],
  inventory_count: ["inventory_balance"],
  study_performance: ["studies_performed", "equipment_load", "staff_output"],
  result_delivery: [],
};

export function registersForDocument(type: DocumentType): readonly RegisterType[] {
  return DOCUMENT_REGISTER_MAP[type] || [];
}
