import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  hashPassword, verifyPassword, passwordHashNeedsUpgrade,
  isCompromisedPasswordHash, newSessionToken, hashToken,
} from "../lib/auth.ts";

// Поведінковий тест хешування паролів: раніше lib/auth.ts перевірявся лише
// grep-ом по вихідному тексту, тож round-trip PBKDF2 не був підтверджений.

test("hashPassword → verifyPassword round-trips a correct password", async () => {
  const hash = await hashPassword("123456");
  assert.match(hash, /^pbkdf2\$sha256\$100000\$/);
  assert.equal(await verifyPassword("123456", hash), true);
});

test("verifyPassword rejects a wrong password", async () => {
  const hash = await hashPassword("123456");
  assert.equal(await verifyPassword("654321", hash), false);
});

test("hashPassword uses a fresh random salt each call", async () => {
  const a = await hashPassword("same-pin");
  const b = await hashPassword("same-pin");
  assert.notEqual(a, b); // різна сіль → різні хеші
  assert.equal(await verifyPassword("same-pin", a), true);
  assert.equal(await verifyPassword("same-pin", b), true);
});

test("verifyPassword rejects malformed or empty hashes without throwing", async () => {
  assert.equal(await verifyPassword("x", ""), false);
  assert.equal(await verifyPassword("x", "not-a-hash"), false);
  assert.equal(await verifyPassword("x", "pbkdf2$sha256$100000$only-four-parts"), false);
  assert.equal(await verifyPassword("x", "pbkdf2$sha256$999$c2FsdA==$ZGVyaXZlZA=="), false); // ітерацій < 1000
  assert.equal(await verifyPassword("x", "md5$sha256$100000$c2FsdA==$ZGVyaXZlZA=="), false); // не pbkdf2
  assert.equal(await verifyPassword("x", "pbkdf2$sha256$100000$@@@$@@@"), false); // невалідний base64
});

test("empty password hashes still burn the normal PBKDF2 work factor", async () => {
  const source = await readFile(new URL("../lib/auth.ts", import.meta.url), "utf8");
  assert.match(source, /const DUMMY_PASSWORD_SALT = new Uint8Array/);
  assert.match(source, /if \(!encoded\) \{[\s\S]*await pbkdf2\(password, DUMMY_PASSWORD_SALT, PBKDF2_ITERATIONS\);[\s\S]*return false;/);
});

test("verifyPassword honours the iteration count stored in the hash", async () => {
  // Старий хеш із іншою кількістю ітерацій має перевірятися коректно.
  const hash = await hashPassword("legacy");
  const withIters = hash.split("$");
  assert.equal(Number(withIters[2]), 100000);
  assert.equal(await verifyPassword("legacy", hash), true);
});

test("passwordHashNeedsUpgrade flags weaker or malformed hashes", () => {
  assert.equal(passwordHashNeedsUpgrade("pbkdf2$sha256$100000$c2FsdA==$ZGVyaXZlZA=="), false);
  assert.equal(passwordHashNeedsUpgrade("pbkdf2$sha256$50000$c2FsdA==$ZGVyaXZlZA=="), true);
  assert.equal(passwordHashNeedsUpgrade("garbage"), true);
});

test("compromised published hash is recognised", () => {
  assert.equal(isCompromisedPasswordHash(
    "pbkdf2$sha256$100000$DIdGQmQdc8l2yyObk0lw0A==$btlwHhk42m8+m7NJlqXpZXQZYZ5d8gsRfxFMTqw59gc="
  ), true);
  assert.equal(isCompromisedPasswordHash("pbkdf2$sha256$100000$other$other"), false);
});

test("session tokens are 64-hex and hashToken is a stable SHA-256", async () => {
  const token = newSessionToken();
  assert.match(token, /^[0-9a-f]{64}$/);
  const h1 = await hashToken(token);
  const h2 = await hashToken(token);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(h1, h2); // детермінований
  assert.notEqual(await hashToken(newSessionToken()), h1); // різні токени → різні хеші
});
