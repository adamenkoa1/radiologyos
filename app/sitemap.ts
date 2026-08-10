import type { MetadataRoute } from "next";
import { CT_SEO_PAGES, FLUORO_SEO_PAGE, XRAY_SEO_PAGE } from "../lib/seo-service-pages";

const BASE_URL = "https://radiologyos.tech";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const servicePages = [
    ...Object.values(CT_SEO_PAGES),
    XRAY_SEO_PAGE,
    FLUORO_SEO_PAGE,
  ].map((page) => ({
    url: `${BASE_URL}${page.path}`,
    lastModified,
    changeFrequency: "weekly" as const,
    priority: page.path === "/ct/" ? 0.9 : 0.8,
  }));

  return [
    { url: `${BASE_URL}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    ...servicePages,
    { url: `${BASE_URL}/site/price.html`, lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE_URL}/site/military.html`, lastModified, changeFrequency: "monthly", priority: 0.8 },
  ];
}
