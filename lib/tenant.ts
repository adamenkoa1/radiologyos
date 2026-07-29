export const DEFAULT_ORGANIZATION_ID = "chernihiv-military-hospital-radiology";
export const DEFAULT_BRANCH_ID = "chernihiv-military-hospital-main";
export const DEFAULT_DEPARTMENT_ID = "chernihiv-military-hospital-radiology-department";

export const DEFAULT_TENANT = {
  organizationId: DEFAULT_ORGANIZATION_ID,
  branchId: DEFAULT_BRANCH_ID,
  departmentId: DEFAULT_DEPARTMENT_ID,
  locale: "uk-UA",
  timezone: "Europe/Kyiv",
  currency: "UAH",
} as const;

export interface TenantContext {
  organizationId: string;
  branchId: string;
  departmentId: string;
}

export function normalizeOrganizationId(value: unknown): string {
  const candidate = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{2,63}$/.test(candidate)
    ? candidate
    : DEFAULT_ORGANIZATION_ID;
}

// The public booking site currently represents the first hospital tenant.
// Hostname/slug routing can be added later without changing repository queries.
export function publicTenant(): TenantContext {
  return {
    organizationId: DEFAULT_ORGANIZATION_ID,
    branchId: DEFAULT_BRANCH_ID,
    departmentId: DEFAULT_DEPARTMENT_ID,
  };
}
