// Публічне читання контенту вітрини для статичного лендинга (/site/*).
// Повертає повний SiteContent (усі поля — публічні тексти).

import { getSetting } from "../../../lib/settings";
import { SITE_CONTENT_KEY, parseSiteContent } from "../../../lib/site-content";
import { dbBinding } from "../../../lib/db";

export async function GET() {
  const db = dbBinding();
  // Без бази — типові значення, щоб сайт лишався робочим.
  const content = db ? parseSiteContent(await getSetting(db, SITE_CONTENT_KEY)) : undefined;
  // Коротке кешування: публічний контент (тексти, колір, лого до 300 КБ)
  // більше не читається з D1 і не пересилається на кожен анонімний візит.
  // Зміни в редакторі стають видимими протягом ~хвилини.
  return Response.json(
    { content: content ?? null },
    { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" } },
  );
}
