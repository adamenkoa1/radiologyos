import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicLocalSeo } from "../../components/public-local-seo";
import { SeoServiceLanding } from "../../components/seo-service-landing";
import { CT_SEO_PAGES } from "../../../lib/seo-service-pages";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug?: string[] }> };

function pageFor(slug?: string[]) {
  if (!slug || slug.length === 0) return CT_SEO_PAGES.index;
  if (slug.length !== 1) return undefined;
  return CT_SEO_PAGES[slug[0]];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = pageFor(slug);
  if (!page) return {};
  return {
    title: page.metaTitle,
    description: page.description,
    alternates: { canonical: page.path },
    openGraph: {
      title: page.metaTitle,
      description: page.description,
      url: page.path,
      locale: "uk_UA",
      type: "website",
    },
  };
}

export default async function CtSeoPage({ params }: Props) {
  const { slug } = await params;
  const page = pageFor(slug);
  if (!page) notFound();
  return (
    <>
      <SeoServiceLanding page={page} />
      <PublicLocalSeo path={page.path} />
    </>
  );
}
