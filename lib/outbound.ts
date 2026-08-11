const MAX_RESPONSE_BYTES = 1_000_000;

function allowedHosts(): Set<string> {
  const raw = (globalThis as typeof globalThis & {
    __RADIOLOGY_OUTBOUND_ALLOWED_HOSTS__?: string;
  }).__RADIOLOGY_OUTBOUND_ALLOWED_HOSTS__ || "";
  return new Set(raw.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
}

function privateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function privateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost"
    || host === "::1"
    || host.startsWith("fc")
    || host.startsWith("fd")
    || host.startsWith("fe80:")
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || privateIpv4(host);
}

export function safeOutboundUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    const allowlist = allowedHosts();
    if (allowlist.size === 0 || !allowlist.has(host)) return null;
    if (privateHostname(host) && !allowlist.has(host)) return null;
    return url;
  } catch {
    return null;
  }
}

export async function fetchLimited(
  url: URL,
  init: RequestInit = {},
  timeoutMs = 5000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, redirect: "error", signal: controller.signal });
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_RESPONSE_BYTES) throw new Error("response_too_large");
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export async function readLimitedText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("response_too_large");
    }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}
