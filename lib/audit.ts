import { DEFAULT_ORGANIZATION_ID } from "./tenant";

export async function logSecurityEvent(
  db: D1Database,
  event: {
    actorEmail: string;
    organizationId?: string;
    action: string;
    resource: string;
    targetId?: string | number;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  const details = JSON.stringify(event.details || {}).slice(0, 4000);
  await db.prepare(
    `INSERT INTO security_audit_log
       (organization_id, actor_email, action, resource, target_id, details_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    event.organizationId || DEFAULT_ORGANIZATION_ID,
    event.actorEmail.slice(0, 254),
    event.action.slice(0, 80),
    event.resource.slice(0, 80),
    String(event.targetId || "").slice(0, 120),
    details,
  ).run();
}
