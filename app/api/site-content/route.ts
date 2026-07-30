// Публічне читання контенту вітрини для статичного лендинга (/site/*).
// Повертає повний SiteContent (усі поля — публічні тексти).

import { getSetting } from "../../../lib/settings";
import { SITE_CONTENT_KEY, parseSiteContent } from "../../../lib/site-content";

function dbBinding() {
  return (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__;
}

export async function GET() {
  const db = dbBinding();
  // Без бази — типові значення, щоб сайт лишався робочим.
  const content = db ? parseSiteContent(await getSetting(db, SITE_CONTENT_KEY)) : undefined;
  return Response.json(
    { content: content ?? null },
    { headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } },
  );
}
