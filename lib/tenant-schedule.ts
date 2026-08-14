import { getSetting, setSetting } from "./settings";
import { parseSchedule, SCHEDULE_KEY, scheduleKey, type ScheduleConfig } from "./schedule";

export async function getOrganizationSchedule(
  db: D1Database,
  organizationId: number,
): Promise<ScheduleConfig> {
  const tenantStored = await getSetting(db, scheduleKey(organizationId));
  if (tenantStored) return parseSchedule(tenantStored);
  if (organizationId === 1) return parseSchedule(await getSetting(db, SCHEDULE_KEY));
  return parseSchedule("");
}

export async function setOrganizationSchedule(
  db: D1Database,
  organizationId: number,
  schedule: ScheduleConfig,
): Promise<void> {
  const serialized = JSON.stringify(schedule);
  await setSetting(db, scheduleKey(organizationId), serialized);
  // Public storefront remains org1-only for now and still reads the legacy key.
  // Mirror org1 writes so public availability/site booking stay compatible.
  if (organizationId === 1) await setSetting(db, SCHEDULE_KEY, serialized);
}
