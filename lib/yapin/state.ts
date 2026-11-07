// The state cookie for Sign in with Yapin'. /auth/yapin/start puts the
// state, the PKCE verifier, where to go next and the mode (sign in or link)
// in one signed cookie; /auth/yapin checks the signature, the expiry and that
// the state matches what Yapin' sent back. Signed with HMAC-SHA-256 under a
// key made from YAPIN_CLIENT_SECRET, so nobody can forge one. Web Crypto
// only, so the tests load it directly.
import { base64url, fromBase64url, isVerifier } from "./pkce.ts";

export const STATE_COOKIE = "yapin_oauth";
/** The cookie only goes to the callback and the start route. */
export const STATE_COOKIE_PATH = "/auth/yapin";
/** Ten minutes to finish on yapin.gg. */
export const STATE_TTL_S = 600;

export type YapinMode = "signin" | "link";

export type YapinState = {
  state: string;
  verifier: string;
  /** A path on this site, already checked with safeNext. */
  next: string;
  mode: YapinMode;
  /** For "link": the account that asked, so the callback links that one only. */
  uid: string | null;
  /** Unix seconds. */
  exp: number;
};

const enc = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  // A key only for this cookie, so the client secret itself is never the key.
  const material = await crypto.subtle.digest("SHA-256", enc.encode(`sloptube yapin state\n${secret}`));
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** The cookie value: base64url(JSON) "." base64url(HMAC). */
export async function sealState(value: YapinState, secret: string): Promise<string> {
  const body = base64url(enc.encode(JSON.stringify(value)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(body));
  return `${body}.${base64url(new Uint8Array(sig))}`;
}

function isState(v: unknown): v is YapinState {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.state === "string" &&
    s.state.length >= 16 &&
    typeof s.verifier === "string" &&
    isVerifier(s.verifier) &&
    typeof s.next === "string" &&
    s.next.startsWith("/") &&
    (s.mode === "signin" || s.mode === "link") &&
    (s.uid === null || typeof s.uid === "string") &&
    typeof s.exp === "number"
  );
}

/**
 * The state from a cookie value, or null when the signature is wrong, it has
 * expired, or it is not one of ours. `nowS` is unix seconds.
 */
export async function openState(cookie: string | undefined | null, secret: string, nowS = Math.floor(Date.now() / 1000)): Promise<YapinState | null> {
  if (!cookie || cookie.length > 4096) return null;
  const [body, sig, extra] = cookie.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const sigBytes = fromBase64url(sig);
  const bodyBytes = fromBase64url(body);
  if (!sigBytes || !bodyBytes) return null;
  // verify() compares in constant time.
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sigBytes as BufferSource, enc.encode(body));
  if (!ok) return null;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch {
    return null;
  }
  if (!isState(value) || value.exp < nowS) return null;
  return value;
}

/** Does the state Yapin' sent back match ours? Same length strings compared without an early exit. */
export function sameState(a: string, b: string | null | undefined): boolean {
  if (typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
