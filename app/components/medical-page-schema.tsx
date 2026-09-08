// Структуровані дані медичної сторінки послуги (JSON-LD).
// Емітить граф MedicalWebPage + BreadcrumbList + MedicalProcedure, прив'язаний
// до клініки. NAP береться з єдиного профілю (lib/public-profile), логіка графа
// — з lib/structured-data.
import { publicOrganizationProfile } from "../../lib/public-profile";
import { medicalPageGraph, safeJsonLd, type StructuredPage } from "../../lib/structured-data";

export async function MedicalPageSchema({ page }: { page: StructuredPage }) {
  const profile = await publicOrganizationProfile();
  const reviewedDate = new Date().toISOString().slice(0, 10);
  const graph = medicalPageGraph(
    page,
    {
      name: profile.name,
      department: profile.department,
      url: profile.url,
      telephone: profile.telephone,
      address: profile.address,
    },
    reviewedDate,
  );
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(graph) }}
    />
  );
}
