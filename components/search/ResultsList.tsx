"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { searchParamsFor, type SearchFilters } from "@/lib/search/query";
import type { SearchPage, SearchVideo } from "@/lib/search/types";
import { VideoResult, VideoResultSkeleton } from "./VideoResult";

/**
 * Video results with infinite scroll. The first page comes with the page
 * from the server; near the end of the list the next one is read from
 * /api/search with the cursor, with two skeleton rows meanwhile.
 */
export function ResultsList({
  q,
  filters,
  words,
  initial,
  now,
}: {
  q: string;
  filters: SearchFilters;
  words: string[];
  initial: SearchPage;
  now: number;
}) {
  const [videos, setVideos] = useState<SearchVideo[]>(initial.videos);
  const [next, setNext] = useState<string | null>(initial.next);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const loadMore = useCallback(async () => {
    if (!next || busy.current) return;
    busy.current = true;
    setLoading(true);
    setFailed(null);
    try {
      const params = searchParamsFor(q, filters);
      params.set("cursor", next);
      const res = await fetch(`/api/search?${params}`);
      if (!res.ok) throw new Error(res.status === 429 ? "rate_limited" : String(res.status));
      const page = (await res.json()) as SearchPage;
      setVideos((old) => {
        const seen = new Set(old.map((v) => v.id));
        return [...old, ...page.videos.filter((v) => !seen.has(v.id))];
      });
      setNext(page.next);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "failed");
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [next, q, filters]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !next || failed) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [next, failed, loadMore]);

  return (
    <>
      <div className="flex flex-col gap-10 search:gap-4" data-search-results data-search-count={videos.length}>
        {videos.map((v) => (
          <VideoResult key={v.id} video={v} now={now} words={words} />
        ))}
        {loading && (
          <>
            <VideoResultSkeleton />
            <VideoResultSkeleton />
          </>
        )}
      </div>
      {next && <div ref={sentinel} aria-hidden className="h-px" data-search-more />}
      {failed && (
        <div className="py-6 text-center">
          <button type="button" onClick={() => void loadMore()} className="text-[14px] font-medium uppercase text-link">
            {failed === "rate_limited" ? "Searching very fast. Wait a minute, then retry" : "Couldn't load more. Retry"}
          </button>
        </div>
      )}
    </>
  );
}
