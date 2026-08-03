import { hashToken } from "./auth";

// One-time owner activation. Only the SHA-256 digest is committed; the raw
// token is shared with the owner once and is never stored in D1 or logs.
export const STAFF_ACTIVATION_TOKEN_HASH = "fe138e93412cdf15e2db07b0938c3c21eb6db7677a97a8eb533e81f7f11bd0c3";
export const STAFF_ACTIVATION_KEY = "staff_owner_activation_v1";

function timingSafeTextEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

export async function activationTokenMatchesHash(rawToken: string, expectedHash: string): Promise<boolean> {
  const token = rawToken.trim();
  if (!/^[0-9a-f]{64}$/i.test(token) || !/^[0-9a-f]{64}$/i.test(expectedHash)) return false;
  return timingSafeTextEqual(await hashToken(token), expectedHash.toLowerCase());
}

export function verifyStaffActivationToken(rawToken: string): Promise<boolean> {
  return activationTokenMatchesHash(rawToken, STAFF_ACTIVATION_TOKEN_HASH);
}
