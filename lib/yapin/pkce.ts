// PKCE for Sign in with Yapin' (RFC 7636, S256). Web Crypto only, so the same
// code runs in route handlers and in the node:test unit tests. No imports.

/** Bytes as base64url without padding. */
export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url back to bytes, or null when it is not base64url. */
export function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  try {
    const raw = atob(padded);
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** `n` random bytes as base64url. */
export function randomToken(n = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(n)));
}

/** The code verifier: 43 characters from 32 random bytes, inside the 43 to 128 the RFC allows. */
export function createVerifier(): string {
  return randomToken(32);
}

/** What the RFC allows in a verifier: 43 to 128 of A-Z a-z 0-9 - . _ ~ */
export function isVerifier(v: string): boolean {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(v);
}

/** The S256 code challenge: base64url(SHA-256(verifier)). */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}
