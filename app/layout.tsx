import type { Metadata } from "next";
import "./globals.css";
import { SITE_URL } from "../lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Променева діагностика | Чернігівський військовий госпіталь",
  description: "Відділення променевої діагностики Чернігівського військового госпіталю: КТ, цифровий рентген, флюорографія, тарифи й онлайн-запис.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/hospital-emblem-transparent.png",
    shortcut: "/hospital-emblem-transparent.png",
  },
  openGraph: {
    title: "Променева діагностика — Чернігівський військовий госпіталь",
    description: "КТ, цифрова рентгенографія та флюорографія для військовослужбовців і цивільних пацієнтів. Онлайн-запис.",
    locale: "uk_UA",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="uk">
      <head>
        <link rel="preload" href="/fonts/inter-cyrillic.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/inter-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/lora-cyrillic.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
