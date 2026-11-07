// Where a viewer came from, for the traffic sources card. The watch page
// asks once, when playback starts. No imports, so Node loads it directly.
//
// Inside the app, pages change without a page load, so document.referrer
// stays what it was when the tab opened. The app keeps the previous path
// itself (lib/stats/useLastPath.ts) and only falls back to the referrer on
// the first page of a visit.

import type { Source } from "./rules.ts";

/** The kind of page a path on this site is. */
export function sourceOfPath(path: string): Source {
  const p = path.split(/[?#]/)[0] || "/";
  if (p === "/" || p === "") return "home";
  if (p === "/results" || p.startsWith("/results/")) return "search";
  if (p === "/feed/subscriptions") return "subscriptions";
  if (p.startsWith("/@") || p.startsWith("/c/") || p.startsWith("/channel/")) return "channel";
  if (p === "/shorts" || p.startsWith("/shorts/")) return "shorts";
  return "other";
}

/**
 * The source for a view: the previous page inside the app when there is one,
 * else the referrer (this site's own pages by their path, another site as
 * external), else direct.
 */
export function viewSource(previousPath: string | null, referrer: string, origin: string): Source {
  if (previousPath) return sourceOfPath(previousPath);
  if (!referrer) return "direct";
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return "direct";
  }
  if (url.origin !== origin) return "external";
  return sourceOfPath(url.pathname);
}
