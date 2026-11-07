// Where to send someone after sign in. Only paths on this site are allowed,
// so a crafted ?next= link cannot bounce people to another website.
// No imports on purpose, so the tests can load this file directly.

export function safeNext(value: string | string[] | null | undefined, fallback = "/"): string {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return fallback;
  if (/[\r\n\t]/.test(v)) return fallback;
  return v;
}
