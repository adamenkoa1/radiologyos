/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { getSetting } from "../lib/settings";
import { parseSiteContent, SITE_CONTENT_KEY } from "../lib/site-content";
import { runDueReminders } from "../lib/reminders";
import { runOperationalTasks } from "../lib/operational-tasks";
import { patientOrderCancellationBlocker, type PatientOrderCancellationBlocker } from "../lib/patient-orders";
import { canAccessBooking, canManageBookings } from "../lib/staff-auth";
import { requireOrgContext } from "../lib/tenant";

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

const LEGACY_HOME_PATHS = new Set(["/index.html", "/site", "/site/", "/site/index.html"]);
const PUBLIC_CANONICAL_PATHS = new Set(["/", "/site/price.html", "/site/military.html"]);
const STATIC_ASSET_PREFIXES = ["/assets/", "/fonts/", "/site/assets/"];
const STATIC_ASSET_PATHS = new Set([
  "/favicon.svg",
  "/file.svg",
  "/globe.svg",
  "/hospital-emblem.jpg",
  "/window.svg",
]);
const INITIAL_ORGANIZATION_ID = 1;

function secure(response: Response, request?: Request): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  if (request) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (PUBLIC_CANONICAL_PATHS.has(pathname)) {
      headers.set("link", `<${new URL(pathname, url.origin).toString()}>; rel="canonical"`);
    }
    if (pathname === "/site/cabinet.html" || pathname === "/cabinet") {
      headers.set("x-robots-tag", "noindex, nofollow");
    }
    const publicCacheable = pathname === "/api/site-content";
    if (!publicCacheable && (pathname.startsWith("/api/") || pathname.startsWith("/staff"))) {
      headers.set("cache-control", "no-store");
    }
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function isStaticAssetPath(pathname: string): boolean {
  return STATIC_ASSET_PATHS.has(pathname) || STATIC_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

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

function patientOrderBlockerMessage(blocker: PatientOrderCancellationBlocker): string {
  if (blocker === "payment_refund_required") return "Спочатку оформіть повернення оплати.";
  if (blocker === "service_storno_required") return "Послуга вже проведена — спочатку оформіть сторно.";
  return "Є незавершений пов’язаний документ. Спочатку скасуйте або завершіть його.";
}

function patientOrderLifecycleConflict(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("booking_cancel_payment_refund_required")) {
    return patientOrderBlockerMessage("payment_refund_required");
  }
  if (message.includes("booking_cancel_service_storno_required")) {
    return patientOrderBlockerMessage("service_storno_required");
  }
  if (message.includes("booking_cancel_downstream_draft_exists")) {
    return patientOrderBlockerMessage("downstream_draft_exists");
  }
  return null;
}

async function recoverStaffCancellationConflict(
  request: Request | null,
  env: Env,
  response: Response,
): Promise<Response | null> {
  if (!request || response.status !== 500) return null;
  const body = await request.json().catch(() => ({})) as { id?: unknown; status?: unknown };
  if (body.status !== "cancelled" || !Number.isInteger(body.id)) return null;
  const org = await requireOrgContext(request, env.DB);
  if (!org || !canManageBookings(org.member.role)) return null;
  const bookingId = Number(body.id);
  if (!(await canAccessBooking(env.DB, org.member, bookingId, org.organizationId))) return null;
  const blocker = await patientOrderCancellationBlocker(env.DB, org.organizationId, bookingId);
  return blocker ? Response.json({ error: patientOrderBlockerMessage(blocker) }, { status: 409 }) : null;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__ = env.DB;
    (globalThis as typeof globalThis & {
      __RADIOLOGY_OUTBOUND_ALLOWED_HOSTS__?: string;
    }).__RADIOLOGY_OUTBOUND_ALLOWED_HOSTS__ = env.OUTBOUND_ALLOWED_HOSTS || "";
    const url = new URL(request.url);

    if (unsafeCrossSiteRequest(request)) {
      return secure(Response.json({ error: "Cross-site request blocked" }, { status: 403 }), request);
    }

    if ((request.method === "GET" || request.method === "HEAD") && isStaticAssetPath(url.pathname)) {
      return secure(await env.ASSETS.fetch(request), request);
    }

    if ((request.method === "GET" || request.method === "HEAD") && LEGACY_HOME_PATHS.has(url.pathname)) {
      const canonicalHome = new URL("/", url);
      canonicalHome.search = url.search;
      return secure(Response.redirect(canonicalHome.toString(), 308), request);
    }

    if (url.pathname === "/") {
      const storefrontRequest = new Request(new URL("/site/index.html", request.url), request);
      return secure(await env.ASSETS.fetch(storefrontRequest), request);
    }

    const wantsMilitary = url.pathname === "/site/military.html"
      || (url.pathname === "/booking" && url.searchParams.get("category") === "military");
    if (wantsMilitary && await storefrontPaidOnly(env.DB)) {
      return secure(Response.redirect(new URL("/site/price.html", request.url).toString(), 302), request);
    }

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

    const staffCancellationProbe = request.method === "PATCH" && url.pathname === "/api/staff/bookings"
      ? request.clone()
      : null;
    try {
      const response = await handler.fetch(request, env, ctx);
      const recovered = await recoverStaffCancellationConflict(staffCancellationProbe, env, response);
      return secure(recovered || response, request);
    } catch (error) {
      const conflict = url.pathname.startsWith("/api/") ? patientOrderLifecycleConflict(error) : null;
      if (conflict) return secure(Response.json({ error: conflict }, { status: 409 }), request);
      throw error;
    }
  },

  async scheduled(_event: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    (globalThis as typeof globalThis & { __RADIOLOGY_DB__?: D1Database }).__RADIOLOGY_DB__ = env.DB;
    const now=Date.now();
    ctx.waitUntil(Promise.allSettled([
      // Patient messaging remains limited to org1 until credentials are tenant-scoped.
      runDueReminders(env.DB, now, INITIAL_ORGANIZATION_ID),
      // Internal operational tasks use no external credentials and are safe for all active tenants.
      runOperationalTasks(env.DB, now),
    ]));
  },
};

export default worker;
