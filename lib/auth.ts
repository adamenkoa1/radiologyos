// Self-managed staff authentication primitives.
//
// Passwords are stored as PBKDF2-HMAC-SHA256 hashes; sessions are opaque
// random tokens whose SHA-256 hash is stored in D1 (`staff_sessions`). Nothing
// here depends on an external identity provider — the application owns the
// whole flow. Runs on the Cloudflare Workers Web Crypto API.

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEYLEN = 32;

export const SESSION_COOKIE = "rid_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password: string, salt: BufferSource, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    PBKDF2_KEYLEN * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(derived)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (!encoded) return false;
  const parts = encoded.split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1000) return false;
  let salt: Uint8Array<ArrayBuffer>;
  let expected: Uint8Array<ArrayBuffer>;
  try {
    salt = fromBase64(parts[3]);
    expected = fromBase64(parts[4]);
  } catch {
    return false;
  }
  const derived = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(derived, expected);
}

// Session tokens: the raw token goes to the client cookie, only its hash is
// stored server-side, so a database leak can't be replayed as a session.
export function newSessionToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(rawToken: string): Promise<string> {
  const bytes = new TextEncoder().encode(rawToken);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(new Uint8Array(digest));
}

export function readCookie(request: Request, name: string): string {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export function sessionCookie(rawToken: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${rawToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
