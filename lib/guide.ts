// Feature 18: the shell follows the flags. Which guide links and top bar
// pieces show for a given set of flags, as pure data, so the demo really is
// one feature at a time (Trending appears when feed goes on, and so on).
// No imports on purpose, so `node --test` can load it directly.

export type GuideKey = "home" | "shorts" | "trending" | "subscriptions" | "library" | "history";

export type ShellFlags = {
  feed?: boolean;
  shorts?: boolean;
  subscriptions?: boolean;
  engagement?: boolean;
  search?: boolean;
};

/** The first guide section: Home, then Snips (11), Trending (6), Subscriptions (7) as their flags go on. */
export function mainGuide(f: ShellFlags): GuideKey[] {
  const out: GuideKey[] = ["home"];
  if (f.shorts) out.push("shorts");
  if (f.feed) out.push("trending");
  if (f.subscriptions) out.push("subscriptions");
  return out;
}

/** The "you" section: Library and History, both part of feature 9 (engagement). Empty hides the section. */
export function youGuide(f: ShellFlags): GuideKey[] {
  return f.engagement ? ["library", "history"] : [];
}

/** The 72 px icon rail: the main section plus Library when there is one. */
export function railGuide(f: ShellFlags): GuideKey[] {
  const you = youGuide(f);
  return you.length ? [...mainGuide(f), you[0]] : mainGuide(f);
}

/** The search box only shows with the search flag (8). */
export function searchShown(f: ShellFlags): boolean {
  return f.search === true;
}
