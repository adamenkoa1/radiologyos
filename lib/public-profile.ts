import { dbBinding } from "./db";
import { getSetting } from "./settings";
import {
  parseSiteContent,
  SITE_CONTENT_DEFAULTS,
  SITE_CONTENT_KEY,
} from "./site-content";
import { SITE_URL } from "./site";

export type PublicOrganizationProfile = {
  name: string;
  department: string;
  telephone: string;
  address: string;
  openingHours: string;
  url: string;
};

/**
 * Canonical public NAP resolver.
 *
 * Public pages and structured data must use this function rather than keeping
 * their own copies of hospital name, phone, address or opening hours.
 */
export async function publicOrganizationProfile(): Promise<PublicOrganizationProfile> {
  const db = dbBinding();
  const content = db
    ? parseSiteContent(await getSetting(db, SITE_CONTENT_KEY))
    : SITE_CONTENT_DEFAULTS;

  return {
    name: content.brandTitle,
    department: content.brandSubtitle,
    telephone: content.phone,
    address: content.address,
    openingHours: content.workHours,
    url: SITE_URL,
  };
}

export function telephoneHref(telephone: string): string {
  const normalized = telephone.replace(/[^+\d]/g, "");
  return normalized ? `tel:${normalized}` : "";
}
