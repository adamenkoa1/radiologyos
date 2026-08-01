import { dbBinding } from "../../../lib/db";
import {
  DEPARTMENT_STRUCTURE_KEY,
  parseDepartmentStructure,
  totalStudies2025,
} from "../../../lib/department-structure";
import { getSetting } from "../../../lib/settings";

export async function GET() {
  const db = dbBinding();
  const structure = parseDepartmentStructure(db ? await getSetting(db, DEPARTMENT_STRUCTURE_KEY) : "");

  // Публікуємо лише інформацію клініки без персональних даних працівників.
  return Response.json({
    profile: {
      hospital: structure.hospital,
      department: structure.department,
      statistics2025: structure.statistics2025,
      totalStudies2025: totalStudies2025(structure),
      rooms: structure.rooms.filter(room => room.devices.some(device => device.status !== "stored")),
      hours: structure.hours,
    },
  }, { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" } });
}
