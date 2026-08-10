import type { Metadata } from "next";
import { SeoServiceLanding } from "../components/seo-service-landing";
import { FLUORO_SEO_PAGE } from "../../lib/seo-service-pages";

export const metadata: Metadata = {
  title: FLUORO_SEO_PAGE.metaTitle,
  description: FLUORO_SEO_PAGE.description,
  alternates: { canonical: FLUORO_SEO_PAGE.path },
  openGraph: {
    title: FLUORO_SEO_PAGE.metaTitle,
    description: FLUORO_SEO_PAGE.description,
    url: FLUORO_SEO_PAGE.path,
    locale: "uk_UA",
    type: "website",
  },
};

export default function FluorographySeoPage() {
  return <SeoServiceLanding page={FLUORO_SEO_PAGE} />;
}
