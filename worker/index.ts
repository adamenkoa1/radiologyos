/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { getSetting } from "../lib/settings";
import { parseSiteContent, SITE_CONTENT_KEY } from "../lib/site-content";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  OUTBOUND_ALLOWED_HOSTS?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
  ].join("; "),
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function secure(response: Response, request?: Request): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  if (request) {
    const pathname = new URL(request.url).pathname;
    // /api/site-content — публічний контент вітрини, кешується самим маршрутом
    // (short max-age); решта /api та /staff лишаються no-store.
    const publicCacheable = pathname === "/api/site-content";
    if (!publicCacheable && (pathname.startsWith("/api/") || pathname.startsWith("/staff"))) {
      headers.set("cache-control", "no-store");
    }
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// Чи вітрина в режимі «лише платні»: читаємо site_content з D1. Помилка/
// відсутність налаштування = типовий режим (paid_and_free), тож військова
// сторінка лишається доступною за замовчуванням.
async function storefrontPaidOnly(db: D1Database): Promise<boolean> {
  try {
    return parseSiteContent(await getSetting(db, SITE_CONTENT_KEY)).storefrontType === "paid_only";
  } catch {
    return false;
  }
}

function unsafeCrossSiteRequest(request: Request): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase())) return false;
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return false;
  if ((request.headers.get("sec-fetch-site") || "").toLowerCase() === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin !== url.origin;
  } catch {
    return true;
  }
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Make the site-owned D1 binding available to server route modules without
    // importing the runtime-only `cloudflare:workers` module into the artifact.
    (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__ = env.DB;
    (globalThis as typeof globalThis & {
      __RADIOLOGY_OUTBOUND_ALLOWED_HOSTS__?: string;
    }).__RADIOLOGY_OUTBOUND_ALLOWED_HOSTS__ = env.OUTBOUND_ALLOWED_HOSTS || "";
    const url = new URL(request.url);

    if (unsafeCrossSiteRequest(request)) {
      return secure(Response.json({ error: "Cross-site request blocked" }, { status: 403 }), request);
    }

    // Public site is the v22 static design served from `public/site`. The root
    // path renders v22's landing; all other `/site/*` files (pages, assets) are
    // served by the normal static-asset handler below. The Next app keeps
    // owning `/staff`, `/api` and everything else.
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const landing = await env.ASSETS.fetch(new URL("/site/index.html", request.url));
      if (landing.ok) {
        return secure(new Response(landing.body, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
        }), request);
      }
    }

    // Режим вітрини «лише платні»: сторінка військових недоступна — і прямий
    // вхід на military.html, і /booking?category=military ведуть на прайс.
    const wantsMilitary = url.pathname === "/site/military.html"
      || (url.pathname === "/booking" && url.searchParams.get("category") === "military");
    if (wantsMilitary && await storefrontPaidOnly(env.DB)) {
      return secure(Response.redirect(new URL("/site/price.html", request.url).toString(), 302), request);
    }

    // Legacy Next public routes → v22 static pages, so nobody lands on the old
    // card-grid booking screen. Civilian price list / military free list / cabinet.
    if (url.pathname === "/booking") {
      const target = url.searchParams.get("category") === "military" ? "/site/military.html" : "/site/price.html";
      return secure(Response.redirect(new URL(target, request.url).toString(), 302), request);
    }
    if (url.pathname === "/cabinet") {
      return secure(Response.redirect(new URL("/site/cabinet.html", request.url).toString(), 302), request);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return secure(await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths), request);
    }

    return secure(await handler.fetch(request, env, ctx), request);
  },
};

export default worker;
