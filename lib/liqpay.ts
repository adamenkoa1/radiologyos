// LiqPay (PrivatBank gateway) checkout signing and callback verification.
//
// Pure module — uses only Web Crypto + base64, so it runs identically in the
// Cloudflare Workers runtime and under Node in tests. No network here: building
// a checkout is just signing a payload; the browser is redirected to LiqPay by
// an auto-submitting form, and LiqPay calls us back on `server_url`.
//
// Signature contract (LiqPay v3): base64( sha1( private_key + data + private_key ) ),
// where `data` is base64( utf8(JSON(payload)) ).

export const LIQPAY_CHECKOUT_URL = "https://www.liqpay.ua/api/3/checkout";

// LiqPay statuses that mean the money is in (one-time card payment / sandbox).
const PAID_STATUSES = new Set(["success", "sandbox", "wait_accept"]);

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeLiqpayData(payload: Record<string, unknown>): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(payload)));
}

export function decodeLiqpayData(data: string): Record<string, unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(base64ToBytes(data))) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function liqpaySignature(privateKey: string, data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${privateKey}${data}${privateKey}`));
  return bytesToBase64(new Uint8Array(digest));
}

export interface LiqpayCheckoutInput {
  publicKey: string;
  privateKey: string;
  amount: number;
  currency?: string;
  description: string;
  orderId: string;
  resultUrl: string;
  serverUrl: string;
  language?: string;
}

// Returns the base64 `data` and its `signature` — the two hidden fields a
// browser form POSTs to LIQPAY_CHECKOUT_URL to open the payment page.
export async function buildLiqpayCheckout(input: LiqpayCheckoutInput): Promise<{ data: string; signature: string }> {
  const payload = {
    public_key: input.publicKey,
    version: 3,
    action: "pay",
    amount: Number(input.amount),
    currency: (input.currency || "UAH").toUpperCase().slice(0, 3),
    description: input.description,
    order_id: input.orderId,
    language: input.language || "uk",
    result_url: input.resultUrl,
    server_url: input.serverUrl,
  };
  const data = encodeLiqpayData(payload);
  const signature = await liqpaySignature(input.privateKey, data);
  return { data, signature };
}

export interface LiqpayCallback {
  ok: boolean;
  status: string;
  orderId: string;
  amount: number;
  paid: boolean;
  payload: Record<string, unknown>;
}

// Verifies the callback signature against our private key and reports whether
// the payment is settled. Never throws — an unverifiable callback returns ok:false.
export async function verifyLiqpayCallback(privateKey: string, data: string, signature: string): Promise<LiqpayCallback> {
  const expected = await liqpaySignature(privateKey, data);
  const ok = Boolean(privateKey) && Boolean(data) && signature === expected;
  const payload = ok ? decodeLiqpayData(data) : {};
  const status = typeof payload.status === "string" ? payload.status : "";
  return {
    ok,
    status,
    orderId: typeof payload.order_id === "string" ? payload.order_id : "",
    amount: typeof payload.amount === "number" ? payload.amount : Number(payload.amount) || 0,
    paid: ok && PAID_STATUSES.has(status),
    payload,
  };
}

// order_id carries the booking codes directly (separated by "~"), so a callback
// is self-describing and settlement needs no extra lookup table.
export function encodeOrderId(codes: string[]): string {
  return codes.join("~").slice(0, 240);
}

export function decodeOrderId(orderId: string): string[] {
  return orderId.split("~").map((code) => code.trim().toUpperCase()).filter(Boolean);
}
