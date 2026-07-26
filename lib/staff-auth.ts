export type StaffRole = "admin" | "registrar" | "radiologist" | "radiographer";

export async function requireStaff(request: Request, db: D1Database) {
  const email = (request.headers.get("oai-authenticated-user-email") || "").trim().toLowerCase();
  if (!email) return null;
  const member = await db.prepare(
    "SELECT email, display_name AS displayName, role FROM staff_members WHERE email = ? AND active = 1 LIMIT 1"
  ).bind(email).first<{email:string;displayName:string;role:StaffRole}>();
  return member || null;
}

export function canManageBookings(role: StaffRole) {
  return role === "admin" || role === "registrar";
}

export function canWriteNotes(role: StaffRole) {
  return role === "admin" || role === "registrar" || role === "radiologist" || role === "radiographer";
}

