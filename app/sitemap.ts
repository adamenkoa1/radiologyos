import type { MetadataRoute } from "next";

const BASE_URL = "https://radiologyos.tech";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: `${BASE_URL}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE_URL}/site/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE_URL}/site/price.html`, lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE_URL}/site/military.html`, lastModified, changeFrequency: "monthly", priority: 0.8 },
  ];
}
