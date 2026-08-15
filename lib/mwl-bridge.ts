const RF_SERVICE_CODES = new Set(["301", "302", "303"]);

export type MwlFeedItem = {
  scheduledProcedureStepId: string;
  accessionNumber: string;
  patientId: string;
  patientName: string;
  patientBirthDate: string;
  modality: "CT" | "DX" | "RF";
  scheduledDate: string;
  scheduledTime: string;
  procedureDescription: string;
  serviceCode: string;
  equipmentId: string;
};

export function modalityForWorklist(serviceCode: string, equipmentId: string): "CT" | "DX" | "RF" {
  if (equipmentId === "ct") return "CT";
  if (RF_SERVICE_CODES.has(serviceCode)) return "RF";
  return "DX";
}

export function canonicalWorklistAccession(bookingCode: string, imagingAccession?: string | null): string {
  const existing = String(imagingAccession || "").trim();
  return existing || String(bookingCode || "").trim();
}

// Shared identity primitive for MWL generation and subsequent PACS study
// verification. Exact bookings follow immutable CRM patient_id; historical
// unlinked bookings remain scoped to one booking and are never merged by phone.
export function mwlIdentityKey(patientId: string | null | undefined, bookingCode: string): string {
  const exact = String(patientId || "").trim().toLowerCase();
  return exact ? `patient:${exact}` : `booking:${String(bookingCode || "").trim()}`;
}

export function parseBearerToken(request: Request): string {
  const value = request.headers.get("authorization") || "";
  const match = /^Bearer\s+([A-Za-z0-9_-]{32,160})$/i.exec(value.trim());
  return match?.[1] || "";
}

export async function hashBridgeToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function generateBridgeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function generateDicomPatientId(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `ROS-${suffix}`;
}

export function validIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function dateSpanDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((end - start) / 86400000) + 1;
}
