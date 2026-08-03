// Public: the department's payment link, if an admin configured one. Used by the
// booking confirmation screen and the patient cabinet for civilian patients.

import { getSetting } from "../../../lib/settings";
import { dbBinding } from "../../../lib/db";

const DEFAULT_PRIVAT24_PAY_LINK = 'https://irc.privatbank.ua/qrstickws/route/qr?type=nextfastpay&params=%7B%22token%22%3A%22cadc7a4d-d56c-4005-9cfe-04a96077f8c1%22%7D';

export async function GET() {
  const db = dbBinding();
  if (!db) return Response.json({ payLink: DEFAULT_PRIVAT24_PAY_LINK });
  const payLink = (await getSetting(db, "pay_link")) || DEFAULT_PRIVAT24_PAY_LINK;
  return Response.json({ payLink }, { headers: { "cache-control": "no-store" } });
}
