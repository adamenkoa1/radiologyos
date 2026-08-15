import { canManageBookings, canManageFinance, type AccessRole } from "./staff-auth";

export type StaffBookingCapabilities = {
  canManageBookings: boolean;
  canViewPatientContact: boolean;
  canManageFinance: boolean;
};

const CONTACT_FIELDS = ["phone", "patientEmail", "marketingSource"] as const;
const FINANCE_FIELDS = [
  "paymentStatus",
  "paymentAmount",
  "paymentMethod",
  "nszuStatus",
  "nszuReference",
  "paidAmount",
  "listedPrice",
] as const;

export function staffBookingCapabilities(role: AccessRole): StaffBookingCapabilities {
  const bookingAdmin = canManageBookings(role);
  return {
    canManageBookings: bookingAdmin,
    canViewPatientContact: bookingAdmin,
    canManageFinance: canManageFinance(role),
  };
}

export function projectBookingForStaff(
  input: Record<string, unknown>,
  capabilities: StaffBookingCapabilities,
): Record<string, unknown> {
  const booking: Record<string, unknown> = { ...input };

  if (!capabilities.canViewPatientContact) {
    for (const field of CONTACT_FIELDS) delete booking[field];
  }

  if (!capabilities.canManageFinance) {
    for (const field of FINANCE_FIELDS) delete booking[field];
  } else {
    // Existing bookings keep the authoritative price snapshot captured when
    // they were created. This derived convenience field is finance-only.
    booking.listedPrice = Number(booking.paymentAmount) || 0;
  }

  return booking;
}
