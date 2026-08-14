import { readFileSync } from "node:fs";

const COMPROMISED_PASSWORD_HASHES = new Set([
  "pbkdf2$sha256$100000$DIdGQmQdc8l2yyObk0lw0A==$btlwHhk42m8+m7NJlqXpZXQZYZ5d8gsRfxFMTqw59gc=",
]);

function validBase64(value) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    return Buffer.from(value, "base64").toString("base64") === value;
  } catch {
    return false;
  }
}

export function isSecureStaffPasswordHash(encoded) {
  if (typeof encoded !== "string" || COMPROMISED_PASSWORD_HASHES.has(encoded)) return false;
  const parts = encoded.split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1000) return false;
  if (!validBase64(parts[3]) || !validBase64(parts[4])) return false;
  return Buffer.from(parts[3], "base64").length >= 16
    && Buffer.from(parts[4], "base64").length === 32;
}

export function secureAdminCount(payload) {
  const rows = Array.isArray(payload?.[0]?.results) ? payload[0].results : [];
  return rows.filter((row) => isSecureStaffPasswordHash(row?.password_hash)).length;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/verify-secure-admin.mjs <wrangler-json-file>");
    process.exit(2);
  }
  const payload = JSON.parse(readFileSync(file, "utf8"));
  if (secureAdminCount(payload) < 1) {
    console.error("Production deploy blocked: no active administrator has a valid secure PBKDF2 password hash.");
    process.exit(1);
  }
  console.log("Secure active administrator credential verified.");
}
