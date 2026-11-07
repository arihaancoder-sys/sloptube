// The anonymous viewer key: a random 'sv' cookie the app sets for a year,
// hashed before it goes to the database (which hashes it again). The cookie
// only tells "the same browser came back"; it is never stored as is.
// Only node: imports, so Node can load this file directly.

import { createHash, randomBytes } from "node:crypto";

export const VIEWER_COOKIE = "sv";
export const VIEWER_COOKIE_MAX_AGE = 365 * 24 * 3600;

/** 32 random bytes, base64url: 43 characters. */
export function newViewerCookie(): string {
  return randomBytes(32).toString("base64url");
}

/** Is this a cookie value the app made? Anything else gets a new one. */
export function isViewerCookie(v: string | null | undefined): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
}

/** What the x-viewer-key header carries: sha256 of the cookie, 64 hex characters. */
export function hashViewerCookie(v: string): string {
  return createHash("sha256").update(`sloptube-sv:${v}`).digest("hex");
}
