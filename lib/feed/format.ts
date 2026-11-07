// Text on a feed card. Only relative imports, so Node can load it directly.
import { shortCount } from "../watch/format.ts";

/** "1 view", "999 views", "1.2K views", "3.4M views". */
export function viewsLabel(views: number): string {
  const n = Math.max(0, Math.floor(Number(views) || 0));
  return n === 1 ? "1 view" : `${shortCount(n)} views`;
}
