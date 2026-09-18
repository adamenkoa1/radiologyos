// TOTP (RFC 6238) для двофакторної автентифікації персоналу — сумісно з
// Google Authenticator / FreeOTP / Aegis тощо. Працює на Web Crypto (Cloudflare
// Worker і Node ≥20). Файл самодостатній (без імпортів) — напряму тестовний.
//
// Секрет — base32 (RFC 4648). HOTP/TOTP на HMAC-SHA1, 6 цифр, крок 30 с. Це
// ДРУГИЙ фактор поверх телефон+PIN, тож зберігання секрета в БД відділення
// прийнятне; за потреби його можна додатково шифрувати ключем середовища.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue; // ігноруємо сторонні символи
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

// Новий секрет: 20 випадкових байтів (160 біт) у base32.
export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

function counterBytes(counter: number): Uint8Array {
  const buf = new Uint8Array(8);
  // 64-бітний лічильник big-endian; поділ на 2^32 щоб уникнути обмежень 32-біт.
  let hi = Math.floor(counter / 0x1_0000_0000);
  let lo = counter % 0x1_0000_0000;
  for (let i = 7; i >= 4; i -= 1) { buf[i] = lo & 0xff; lo = Math.floor(lo / 256); }
  for (let i = 3; i >= 0; i -= 1) { buf[i] = hi & 0xff; hi = Math.floor(hi / 256); }
  return buf;
}

async function hotp(secret: string, counter: number, digits = TOTP_DIGITS): Promise<string> {
  const keyBytes = base32Decode(secret);
  const key = await crypto.subtle.importKey(
    "raw", keyBytes as unknown as ArrayBuffer, { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes(counter) as unknown as ArrayBuffer));
  const offset = sig[sig.length - 1] & 0x0f;
  const bin = ((sig[offset] & 0x7f) << 24)
    | ((sig[offset + 1] & 0xff) << 16)
    | ((sig[offset + 2] & 0xff) << 8)
    | (sig[offset + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, "0");
}

// Код TOTP для моменту now (мс). За замовчуванням — поточний час.
export async function totp(
  secret: string,
  { now = Date.now(), step = TOTP_STEP_SECONDS, digits = TOTP_DIGITS }: { now?: number; step?: number; digits?: number } = {},
): Promise<string> {
  return hotp(secret, Math.floor(now / 1000 / step), digits);
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Перевірка коду з допуском ±window кроків (типово ±1 = ±30 с проти розсинхро-
// нізації годинника). Порівняння сталого часу.
export async function verifyTotp(
  secret: string,
  code: string,
  { now = Date.now(), step = TOTP_STEP_SECONDS, digits = TOTP_DIGITS, window = 1 }: {
    now?: number; step?: number; digits?: number; window?: number;
  } = {},
): Promise<boolean> {
  const normalized = String(code || "").replace(/\s+/g, "");
  if (!/^\d+$/.test(normalized) || normalized.length !== digits || !secret) return false;
  const base = Math.floor(now / 1000 / step);
  for (let w = -window; w <= window; w += 1) {
    const candidate = await hotp(secret, base + w, digits);
    if (timingSafeEqualStr(candidate, normalized)) return true;
  }
  return false;
}

// otpauth:// URI для QR/ручного додавання в застосунок-автентифікатор.
export function otpauthUri(
  secret: string,
  { label, issuer }: { label: string; issuer: string },
): string {
  const l = encodeURIComponent(`${issuer}:${label}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${l}?${params.toString()}`;
}
