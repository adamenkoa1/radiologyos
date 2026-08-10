import type { Metadata } from "next";
import { SeoServiceLanding } from "../components/seo-service-landing";
import { XRAY_SEO_PAGE } from "../../lib/seo-service-pages";

export const metadata: Metadata = {
  title: XRAY_SEO_PAGE.metaTitle,
  description: XRAY_SEO_PAGE.description,
  alternates: { canonical: XRAY_SEO_PAGE.path },
  openGraph: {
    title: XRAY_SEO_PAGE.metaTitle,
    description: XRAY_SEO_PAGE.description,
    url: XRAY_SEO_PAGE.path,
    locale: "uk_UA",
    type: "website",
  },
};

export default function XraySeoPage() {
  return <SeoServiceLanding page={XRAY_SEO_PAGE} />;
}
