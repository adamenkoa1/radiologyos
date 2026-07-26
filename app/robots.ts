import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/privacy"], disallow: ["/api/", "/staff", "/cabinet"] }],
    sitemap: "https://chernihiv-radiology-booking.adamenko-artem96.chatgpt.site/sitemap.xml",
  };
}

