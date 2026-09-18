// TOTP (RFC 6238) — чиста криптологіка. Звірка з офіційними тест-векторами
// стандарту (SHA-1, секрет ASCII "12345678901234567890"), 6 цифр.

import assert from "node:assert/strict";
import test from "node:test";
import {
  base32Encode, base32Decode, generateTotpSecret, totp, verifyTotp,
} from "../lib/totp.ts";

const RFC_SECRET = base32Encode(new TextEncoder().encode("12345678901234567890"));

test("base32 encode/decode round-trips and matches the RFC seed", () => {
  assert.equal(RFC_SECRET, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 250, 255]);
  assert.deepEqual([...base32Decode(base32Encode(bytes))], [...bytes]);
});

test("totp reproduces RFC 6238 SHA-1 vectors (last 6 digits)", async () => {
  assert.equal(await totp(RFC_SECRET, { now: 59_000 }), "287082"); // T=59  → 94287082
  assert.equal(await totp(RFC_SECRET, { now: 1111111109_000 }), "081804"); // → 07081804
  assert.equal(await totp(RFC_SECRET, { now: 1234567890_000 }), "005924"); // → 89005924
  assert.equal(await totp(RFC_SECRET, { now: 2000000000_000 }), "279037"); // → 69279037
});

test("verifyTotp accepts the current code, tolerates ±1 step, rejects wrong/malformed", async () => {
  const now = 1234567890_000;
  const code = await totp(RFC_SECRET, { now });
  assert.equal(await verifyTotp(RFC_SECRET, code, { now }), true);
  // Код попереднього кроку приймається в межах вікна ±1 (розсинхрон годинника).
  assert.equal(await verifyTotp(RFC_SECRET, code, { now: now + 30_000 }), true);
  // За межами вікна — вже ні.
  assert.equal(await verifyTotp(RFC_SECRET, code, { now: now + 120_000 }), false);
  assert.equal(await verifyTotp(RFC_SECRET, "000000", { now }), false);
  assert.equal(await verifyTotp(RFC_SECRET, "12345", { now }), false); // не 6 цифр
  assert.equal(await verifyTotp(RFC_SECRET, "abcdef", { now }), false);
  assert.equal(await verifyTotp("", code, { now }), false); // без секрета
});

test("generateTotpSecret yields a decodable 20-byte (160-bit) base32 secret", () => {
  const s = generateTotpSecret();
  assert.match(s, /^[A-Z2-7]+$/);
  assert.equal(base32Decode(s).length, 20);
});
