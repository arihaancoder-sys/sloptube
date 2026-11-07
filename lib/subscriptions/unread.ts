// The notification bell's unread badge and the guide's "new upload" dot.
// The last time the person opened the menu is kept in localStorage, so the
// badge is per browser for now. No imports, so Node can load this file directly.

export const SEEN_KEY = "sloptube-notifications-seen";

/** How many uploads the menu lists. */
export const NOTIFICATION_COUNT = 20;

/** A channel gets the guide dot when it uploaded within this many days. */
export const NEW_UPLOAD_DAYS = 7;

/** The stored "last seen" time back as a number, or null when missing or broken. */
export function parseSeen(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,15}$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Uploads published after the last visit. Never seen: all of them count.
 * Uploads dated in the future (a clock ahead of ours) count as unread too.
 */
export function unreadCount(items: { publishedAt: string }[], seen: number | null): number {
  if (seen === null) return items.length;
  return items.filter((i) => {
    const t = Date.parse(i.publishedAt);
    return !Number.isNaN(t) && t > seen;
  }).length;
}

/** The badge text: nothing at 0, "9+" from 10. */
export function badgeLabel(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 9 ? "9+" : String(Math.floor(count));
}

/**
 * What to store when the menu opens: the newest upload's time or now,
 * whichever is later, so a clock ahead of ours does not keep the badge on.
 */
export function seenStamp(items: { publishedAt: string }[], now: number): number {
  let newest = now;
  for (const i of items) {
    const t = Date.parse(i.publishedAt);
    if (!Number.isNaN(t) && t > newest) newest = t;
  }
  return newest;
}

/** The guide dot: uploaded within the last NEW_UPLOAD_DAYS days. */
export function hasNewUpload(latestUploadAt: string | null | undefined, now: number): boolean {
  if (!latestUploadAt) return false;
  const t = Date.parse(latestUploadAt);
  return !Number.isNaN(t) && now - t < NEW_UPLOAD_DAYS * 86_400_000;
}
