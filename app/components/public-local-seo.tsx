import { publicOrganizationProfile, telephoneHref } from "../../lib/public-profile";

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export async function PublicLocalSeo({ path }: { path: string }) {
  const profile = await publicOrganizationProfile();
  const schema = {
    "@context": "https://schema.org",
    "@type": "MedicalClinic",
    name: `${profile.name} — ${profile.department}`,
    url: new URL(path, profile.url).toString(),
    telephone: profile.telephone,
    address: {
      "@type": "PostalAddress",
      streetAddress: profile.address,
      addressCountry: "UA",
    },
    openingHours: profile.openingHours,
  };
  const tel = telephoneHref(profile.telephone);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJson(schema) }}
      />
      <section
        aria-label="Контактна інформація відділення"
        style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px 48px" }}
      >
        <div style={{ borderTop: "1px solid #d7e8e6", paddingTop: 24, lineHeight: 1.7 }}>
          <strong>{profile.name} — {profile.department}</strong>
          <div>{profile.address}</div>
          <div>{profile.openingHours}</div>
          {tel ? <div><a href={tel}>{profile.telephone}</a></div> : null}
        </div>
      </section>
    </>
  );
}
