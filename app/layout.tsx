import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://chernihiv-radiology-booking.adamenko-artem96.chatgpt.site"),
  title: "Променева діагностика — Чернігівський військовий госпіталь",
  description: "КТ, цифрова рентгенографія та флюорографія у Чернігові. Онлайн-запис на дослідження.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "Променева діагностика — Чернігівський військовий госпіталь",
    description: "КТ, цифрова рентгенографія та флюорографія у Чернігові. Онлайн-запис на дослідження.",
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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
