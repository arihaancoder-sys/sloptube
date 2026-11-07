"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ShortCard, ShortCardSkeleton, shortsGridClass } from "@/components/shorts/ShortCard";
import { ShortsShelf } from "@/components/shorts/ShortsShelf";
import { SkeletonRow, VideoCard, videoGridClass } from "@/components/VideoCard";
import type { FeedCard, FeedKind, FeedPage } from "@/lib/feed/types";
import { SHELF_AFTER, SHELF_SIZE } from "@/lib/shorts/rules";
import { groupShelf } from "@/lib/shorts/shelf";
import type { Short } from "@/lib/shorts/types";
import { useTimezoneOffset } from "@/lib/subscriptions/client-clock";
import { bucketSections } from "@/lib/subscriptions/sections";

/** Thumbnails in the first row load right away; the rest wait until they come near the screen. */
const EAGER = 4;

/**
 * The video grid with infinite scroll. The first page comes from the server
 * with the page; when the end of the grid gets near, the next page is read
 * from /api/feed with the cursor, and a row of skeleton cards shows meanwhile.
 * kind "subscriptions" reads /api/subscriptions/feed and puts the cards under
 * Today, This week and Older headers. kind "channel_shorts" shows 9:16
 * cards. `shelf` (the home feed with the shorts flag on) puts the Snips
 * shelf after the first cards.
 */
export function FeedGrid({
  kind,
  initial,
  channelId,
  now,
  ranked = false,
  shelf = [],
}: {
  kind: FeedKind | "subscriptions";
  initial: FeedPage;
  channelId?: string;
  now: number;
  ranked?: boolean;
  shelf?: Short[];
}) {
  const [cards, setCards] = useState<FeedCard[]>(initial.cards);
  const [next, setNext] = useState<string | null>(initial.next);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  // Sections use the viewer's calendar days. The server renders in UTC; the
  // browser buckets again with its own time zone once it has mounted.
  const tzOffset = useTimezoneOffset();

  // The next page is read ahead once the browser is idle (feature 15), so
  // the cards are there the moment the end of the grid comes near.
  const ahead = useRef<{ cursor: string; page: Promise<FeedPage> } | null>(null);
  const fetchPage = useCallback(
    (cursor: string): Promise<FeedPage> => {
      if (ahead.current?.cursor === cursor) return ahead.current.page;
      const params = new URLSearchParams({ cursor });
      if (kind !== "subscriptions") params.set("kind", kind);
      if (channelId) params.set("channel", channelId);
      const page = fetch(`${kind === "subscriptions" ? "/api/subscriptions/feed" : "/api/feed"}?${params}`).then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as FeedPage;
      });
      ahead.current = { cursor, page };
      // A failed read ahead is tried again by loadMore.
      page.catch(() => {
        if (ahead.current?.page === page) ahead.current = null;
      });
      return page;
    },
    [kind, channelId],
  );

  const loadMore = useCallback(async () => {
    if (!next || busy.current) return;
    busy.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const page = await fetchPage(next);
      setCards((old) => {
        const seen = new Set(old.map((c) => c.id));
        return [...old, ...page.cards.filter((c) => !seen.has(c.id))];
      });
      setNext(page.next);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [next, fetchPage]);

  useEffect(() => {
    if (!next || failed) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const run = () => void fetchPage(next).catch(() => {});
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(run, { timeout: 3000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(run, 1500);
    return () => window.clearTimeout(id);
  }, [next, failed, fetchPage]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !next || failed) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    }, { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [next, failed, loadMore]);

  if (kind === "channel_shorts") {
    return (
      <>
        <div className={shortsGridClass} data-feed-grid={kind} data-feed-count={cards.length}>
          {cards.map((c) => (
            <ShortCard key={c.id} video={c} />
          ))}
          {loading && [0, 1, 2, 3].map((i) => <ShortCardSkeleton key={i} />)}
        </div>
        {next && <div ref={sentinel} aria-hidden className="h-px" data-feed-more />}
      </>
    );
  }

  if (shelf.length > 0) {
    const g = groupShelf(cards, shelf, { at: SHELF_AFTER, max: SHELF_SIZE });
    return (
      <>
        <div data-feed-grid={kind} data-feed-count={g.before.length + g.after.length}>
          {/* dense: the shelf spans the row, and the cards around it fill the rows above and below. */}
          <div className={`${videoGridClass} grid-flow-row-dense`}>
            {g.before.map((c, i) => (
              <VideoCard key={c.id} video={c} now={now} eager={i < EAGER} heading="h2" />
            ))}
            <ShortsShelf shorts={g.shelf} />
            {g.after.map((c) => (
              <VideoCard key={c.id} video={c} now={now} heading="h2" />
            ))}
            {loading && <SkeletonRow />}
          </div>
        </div>
        {next && <div ref={sentinel} aria-hidden className="h-px" data-feed-more />}
        {failed && (
          <div className="py-6 text-center">
            <button type="button" onClick={() => void loadMore()} className="text-[14px] font-medium uppercase text-link">
              Couldn&apos;t load more. Retry
            </button>
          </div>
        )}
      </>
    );
  }

  const sections =
    kind === "subscriptions"
      ? bucketSections(cards, now, tzOffset)
      : [{ key: "all", label: "", items: cards }];

  return (
    <>
      <div data-feed-grid={kind} data-feed-count={cards.length}>
        {sections.map((section, si) => (
          <section key={section.key} data-feed-section={kind === "subscriptions" ? section.key : undefined} className={si > 0 ? "mt-10 border-t border-divider pt-6" : ""}>
            {section.label && <h2 className="mb-4 px-3 text-[16px] font-medium leading-[22px] text-text sm:px-0">{section.label}</h2>}
            <div className={videoGridClass}>
              {section.items.map((c, i) => (
                <VideoCard key={c.id} video={c} now={now} rank={ranked ? i + 1 : undefined} eager={si === 0 && i < EAGER} heading={section.label ? "h3" : "h2"} />
              ))}
              {loading && si === sections.length - 1 && <SkeletonRow />}
            </div>
          </section>
        ))}
        {loading && sections.length === 0 && (
          <div className={videoGridClass}>
            <SkeletonRow />
          </div>
        )}
      </div>
      {next && <div ref={sentinel} aria-hidden className="h-px" data-feed-more />}
      {failed && (
        <div className="py-6 text-center">
          <button type="button" onClick={() => void loadMore()} className="text-[14px] font-medium uppercase text-link">
            Couldn&apos;t load more. Retry
          </button>
        </div>
      )}
    </>
  );
}
