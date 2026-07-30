// Календар-провайдер: читає зовнішній iCal-фід (external_ics_url) організації
// й повертає найближчі події. Уся зовнішня взаємодія — через політику
// підключень (safeOutboundUrl + fetchLimited). Best-effort: ніколи не кидає.

import { parseIcs } from "../ics-parse";
import { fetchLimited, readLimitedText, safeOutboundUrl } from "../outbound";
import type { CalendarProvider } from "./types";

export function createCalendarProvider(icsUrl: string): CalendarProvider {
  const url = icsUrl || "";
  return {
    name: url ? "ics" : "none",
    configured: !!url,
    async listUpcoming() {
      if (!url) return { configured: false, events: [] };
      const safeUrl = safeOutboundUrl(url);
      if (!safeUrl) {
        return { configured: true, events: [], error: "Адресу календаря заблоковано політикою вихідних з’єднань" };
      }
      try {
        const response = await fetchLimited(safeUrl, { cf: { cacheTtl: 300 } } as RequestInit, 5000);
        if (!response.ok) return { configured: true, events: [], error: "Не вдалося завантажити календар" };
        const text = await readLimitedText(response);
        const events = parseIcs(text, Date.now() - 12 * 60 * 60 * 1000, 40);
        return { configured: true, events };
      } catch {
        return { configured: true, events: [], error: "Не вдалося завантажити календар" };
      }
    },
  };
}
