"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { trackClientAnalytics } from "../../lib/client-analytics";
import type { SeoServicePage } from "../../lib/seo-service-pages";

type PublicService = {
  code: string;
  title: string;
  durationMinutes: number;
  price: number;
  availableToCivilian: boolean;
};

function money(value: number) {
  return new Intl.NumberFormat("uk-UA").format(value) + " грн";
}

export function SeoServiceLanding({ page }: { page: SeoServicePage }) {
  const [services, setServices] = useState<PublicService[]>([]);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    trackClientAnalytics("page_view", { pageKey: page.path });
    trackClientAnalytics("service_view", { pageKey: page.path });
    let active = true;
    fetch("/api/public-services", { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("services unavailable");
        return response.json() as Promise<{ services?: PublicService[] }>;
      })
      .then((payload) => {
        if (active) setServices(Array.isArray(payload.services) ? payload.services : []);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => { active = false; };
  }, [page.path]);

  const visible = useMemo(() => {
    const wanted = new Set(page.serviceCodes);
    return services.filter((service) => wanted.has(service.code) && service.availableToCivilian);
  }, [page.serviceCodes, services]);

  const bookingStarted = (serviceCode = "") => {
    trackClientAnalytics("booking_started", {
      pageKey: page.path,
      serviceCode,
      patientCategory: "civilian",
    });
  };

  return (
    <main style={{ minHeight: "100vh", background: "#f5fbfa", color: "#173b3a" }}>
      <header style={{ background: "#0d6b68", color: "white" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", padding: "18px 24px", display: "flex", justifyContent: "space-between", gap: 20, alignItems: "center" }}>
          <Link href="/" style={{ color: "white", textDecoration: "none", fontWeight: 800 }}>RadiologyOS</Link>
          <nav style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Link href="/ct/" style={{ color: "white" }}>КТ</Link>
            <Link href="/xray/" style={{ color: "white" }}>Рентген</Link>
            <Link href="/fluorography/" style={{ color: "white" }}>Флюорографія</Link>
          </nav>
        </div>
      </header>

      <section style={{ maxWidth: 1080, margin: "0 auto", padding: "54px 24px 24px" }}>
        <div style={{ fontSize: 14, marginBottom: 16 }}><Link href="/">Головна</Link> → <span>{page.title}</span></div>
        <h1 style={{ fontSize: "clamp(34px, 6vw, 60px)", lineHeight: 1.05, margin: 0, maxWidth: 900 }}>{page.title}</h1>
        <p style={{ fontSize: 20, lineHeight: 1.65, maxWidth: 850, marginTop: 22 }}>{page.intro}</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 28 }}>
          <Link onClick={() => bookingStarted()} href="/site/price.html" style={{ background: "#0d6b68", color: "white", padding: "13px 20px", borderRadius: 10, textDecoration: "none", fontWeight: 700 }}>Записатися на дослідження</Link>
        </div>
      </section>

      <section style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 24px" }}>
        <h2 style={{ fontSize: 30 }}>Дослідження та актуальні ціни</h2>
        {loadError ? <p>Актуальні ціни тимчасово не вдалося завантажити. Перейдіть до запису, щоб побачити доступні послуги.</p> : null}
        {!loadError && services.length === 0 ? <p>Завантажуємо актуальний перелік послуг…</p> : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
          {visible.map((service) => (
            <article key={service.code} style={{ background: "white", border: "1px solid #d7e8e6", borderRadius: 16, padding: 20 }}>
              <div style={{ fontSize: 13, opacity: 0.65 }}>Код {service.code}</div>
              <h3 style={{ fontSize: 20, lineHeight: 1.35 }}>{service.title}</h3>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 16 }}>{money(service.price)}</div>
              <div style={{ opacity: 0.7, marginTop: 6 }}>Орієнтовний слот: {service.durationMinutes} хв</div>
              <Link onClick={() => bookingStarted(service.code)} href="/site/price.html" style={{ display: "inline-block", marginTop: 18, fontWeight: 700 }}>Обрати час →</Link>
            </article>
          ))}
        </div>
      </section>

      <section style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 24px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
        <div style={{ background: "white", borderRadius: 16, padding: 24 }}>
          <h2>Як підготуватися</h2>
          <ul>{page.preparation.map((item) => <li key={item} style={{ marginBottom: 10, lineHeight: 1.5 }}>{item}</li>)}</ul>
        </div>
        <div style={{ background: "white", borderRadius: 16, padding: 24 }}>
          <h2>Що взяти із собою</h2>
          <ul>{page.whatToBring.map((item) => <li key={item} style={{ marginBottom: 10, lineHeight: 1.5 }}>{item}</li>)}</ul>
        </div>
      </section>

      <section style={{ maxWidth: 1080, margin: "0 auto", padding: "28px 24px 64px" }}>
        <div style={{ background: "#dff3f0", borderRadius: 18, padding: 28 }}>
          <h2 style={{ marginTop: 0 }}>Онлайн-запис</h2>
          <p style={{ fontSize: 18, lineHeight: 1.6 }}>Оберіть послугу та доступний час. Остаточна вартість формується з актуального тарифу RadiologyOS на момент запису.</p>
          <Link onClick={() => bookingStarted()} href="/site/price.html" style={{ display: "inline-block", background: "#0d6b68", color: "white", padding: "13px 20px", borderRadius: 10, textDecoration: "none", fontWeight: 700 }}>Перейти до запису</Link>
        </div>
      </section>
    </main>
  );
}
