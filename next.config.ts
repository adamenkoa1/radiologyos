import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/index.html", destination: "/site/", permanent: true },
      { source: "/site/index.html", destination: "/site/", permanent: true },
      { source: "/price.html", destination: "/site/price.html", permanent: true },
      { source: "/military.html", destination: "/site/military.html", permanent: true },
      { source: "/cabinet.html", destination: "/site/cabinet.html", permanent: true },
      { source: "/booking.html", destination: "/site/price.html", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/staff/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
      {
        source: "/site/cabinet.html",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
    ];
  },
};

export default nextConfig;
