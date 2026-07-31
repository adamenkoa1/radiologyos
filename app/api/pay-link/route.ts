// Public: the department's payment link, if an admin configured one. Used by the
// booking confirmation screen and the patient cabinet for civilian patients.

import { getSetting } from "../../../lib/settings";
import { dbBinding } from "../../../lib/db";

export async function GET() {
  const db = dbBinding();
  if (!db) return Response.json({ payLink: "" });
  const payLink = await getSetting(db, "pay_link");
  return Response.json({ payLink }, { headers: { "cache-control": "no-store" } });
}
