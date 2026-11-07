"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { groupHistory } from "@/lib/engagement/history";
import { engagementErrorMessage } from "@/lib/engagement/rules";
import type { HistoryCard, HistoryPage } from "@/lib/engagement/types";
import { useProgress } from "@/lib/store/progress";
import { useSubscriptions } from "@/lib/store/subscriptions";
import { useTimezoneOffset } from "@/lib/subscriptions/client-clock";
import { HistorySide } from "./HistorySide";
import { HistoryRow, HistoryRowSkeleton } from "./HistoryRow";

/**
 * The history list and its right column. Rows sit under Today, Yesterday
 * and date headers in the viewer's own time zone; more load from
 * /api/history as you scroll. The X removes a row at once (it comes back,
 * with a message, if the server says no).
 */
export function HistoryList({ initial, paused, now }: { initial: HistoryPage; paused: boolean; now: number }) {
  const [cards, setCards] = useState<HistoryCard[]>(initial.cards);
  const [next, setNext] = useState<string | null>(initial.next);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const tzOffset = useTimezoneOffset();
  const put = useProgress((s) => s.put);
  const showToast = useSubscriptions((s) => s.showToast);

  const loadMore = useCallback(async () => {
    if (!next || busy.current) return;
    busy.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/history?${new URLSearchParams({ cursor: next })}`);
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as HistoryPage;
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
  }, [next]);

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

  const remove = async (id: string) => {
    const index = cards.findIndex((c) => c.id === id);
    const card = cards[index];
    if (!card) return;
    setCards((old) => old.filter((c) => c.id !== id));
    put({ [id]: 0 });
    try {
      const res = await fetch("/api/history", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId: id }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "failed");
      showToast("Removed from Watch history");
    } catch (err) {
      setCards((old) => (old.some((c) => c.id === id) ? old : [...old.slice(0, index), card, ...old.slice(index)]));
      put({ [id]: card.progress });
      showToast(engagementErrorMessage(err instanceof Error ? err.message : "failed"));
    }
  };

  const cleared = () => {
    put(Object.fromEntries(cards.map((c) => [c.id, 0])));
    setCards([]);
    setNext(null);
  };

  const groups = groupHistory(cards, now, tzOffset);

  return (
    <div className="history-grid">
      <div className="min-w-0" data-history-list data-history-count={cards.length}>
        <h1 className="mb-2 px-3 pt-4 text-[16px] font-normal leading-[22px] text-text search:px-0 search:pt-6">Watch history</h1>
        {cards.length === 0 && !loading ? (
          <p className="px-3 py-6 text-[14px] text-text-2 search:px-0" data-history-empty>
            This list has no videos.
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.key} data-history-day={g.key} className="pb-2">
              <h2 className="px-3 pb-3 pt-4 text-[16px] font-medium leading-[22px] text-text search:px-0" data-history-day-label>
                {g.label}
              </h2>
              <div className="flex flex-col gap-3 search:gap-4">
                {g.items.map((c) => (
                  <HistoryRow key={c.id} video={c} onRemove={(id) => void remove(id)} />
                ))}
              </div>
            </section>
          ))
        )}
        {loading && (
          <div className="flex flex-col gap-4 pt-4">
            <HistoryRowSkeleton />
            <HistoryRowSkeleton />
          </div>
        )}
        {next && <div ref={sentinel} aria-hidden className="h-px" data-history-more />}
        {failed && (
          <div className="py-6 text-center">
            <button type="button" onClick={() => void loadMore()} className="text-[14px] font-medium uppercase text-link">
              Couldn&apos;t load more. Retry
            </button>
          </div>
        )}
      </div>
      <HistorySide paused={paused} onCleared={cleared} />
    </div>
  );
}
