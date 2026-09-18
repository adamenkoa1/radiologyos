import { seedStaffSession } from "./d1.mjs";

// Production requires an explicit active membership. This wrapper keeps legacy
// behavior fixtures honest without teaching requireOrgContext to auto-enrol.
export async function seedTenantStaffSession(db, options) {
  const organizationId = Number(options?.organizationId || 1);
  const cookie = await seedStaffSession(db, options);
  await db.prepare(
    `INSERT INTO memberships (organization_id, member_email, role, active)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(organization_id, member_email) DO UPDATE SET role = excluded.role, active = 1`
  ).bind(organizationId, options.email, options.role).run();
  return cookie;
}
