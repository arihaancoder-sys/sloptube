"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { ArrowDropDownIcon, ArrowDropUpIcon } from "@/components/icons";
import { ShareDialog } from "@/components/watch/ShareDialog";
import { viewsLabel } from "@/lib/feed/format";
import { mergePage } from "@/lib/shorts/cursor";
import type { Short, ShortsPage } from "@/lib/shorts/types";
import { useFlag } from "@/lib/store/session";
import { CommentsSheet } from "./CommentsSheet";
import { ShortPlayer } from "./ShortPlayer";
import { ShortRail } from "./ShortRail";

/** Load the next page when this few shorts are left below the one on screen. */
const LOAD_AHEAD = 3;
/** Wheel movement that counts as "next" or "previous"... */
const WHEEL_STEP = 40;
/** ...and the quiet time that ends one wheel gesture (trackpads keep sending events). */
const WHEEL_QUIET_MS = 450;

/**
 * /shorts: one short per screen, in a column that snaps. Swipe or scroll to
 * move, or use the arrow keys (and the arrow buttons on desktop). The short
 * on screen plays and loops, muted until the first tap. The address follows
 * the short on screen (/shorts/<id>), so it can be shared or reloaded. More
 * shorts load from /api/shorts as the end gets near.
 */
export function ShortsFeed({ start, initial }: { start: Short | null; initial: ShortsPage }) {
  const [shorts, setShorts] = useState<Short[]>(() => (start ? mergePage([start], initial.shorts) : initial.shorts));
  const [next, setNext] = useState<string | null>(initial.next);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const [comments, setComments] = useState<Short | null>(null);
  const [share, setShare] = useState<Short | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const likesOn = useFlag("engagement");

  const loadMore = useCallback(async () => {
    if (!next || busy.current) return;
    busy.current = true;
    try {
      const res = await fetch(`/api/shorts?cursor=${encodeURIComponent(next)}`);
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as ShortsPage;
      setShorts((old) => mergePage(old, page.shorts));
      setNext(page.next);
    } catch {
      // Try again on the next move.
    } finally {
      busy.current = false;
    }
  }, [next]);

  // The observer below reads the latest of these.
  const more = useRef({ loadMore, count: shorts.length });
  useEffect(() => {
    more.current = { loadMore, count: shorts.length };
  }, [loadMore, shorts.length]);

  // Which short is on screen: the one most of the column shows.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = Number((e.target as HTMLElement).dataset.index);
          setActive(i);
          if (i >= more.current.count - 1 - LOAD_AHEAD) void more.current.loadMore();
        }
      },
      { root, threshold: 0.6 },
    );
    root.querySelectorAll("[data-short]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [shorts.length]);

  // The address follows the short on screen.
  const activeId = shorts[active]?.id;
  useEffect(() => {
    if (activeId && window.location.pathname !== `/shorts/${activeId}`) {
      window.history.replaceState(window.history.state, "", `/shorts/${activeId}`);
    }
  }, [activeId]);

  const go = useCallback(
    (i: number) => {
      const root = scroller.current;
      if (!root) return;
      const to = Math.max(0, Math.min(i, shorts.length));
      root.scrollTo({ top: to * root.clientHeight, behavior: "smooth" });
    },
    [shorts.length],
  );

  // Arrow keys move one short, unless typing (a comment) or a box is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (share || (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName)))) return;
      if (e.key === "ArrowDown" || e.key === "PageDown") go(active + 1);
      else if (e.key === "ArrowUp" || e.key === "PageUp") go(active - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, go, share]);

  // The wheel moves one short per gesture, like the arrow keys, instead of
  // leaving it to the browser's snapping (which differs between mice and
  // trackpads). Inside the comments sheet the wheel scrolls the comments.
  const hasShorts = shorts.length > 0;
  const wheel = useRef({ go, active, sum: 0, locked: false, timer: undefined as ReturnType<typeof setTimeout> | undefined });
  useEffect(() => {
    wheel.current.go = go;
    wheel.current.active = active;
  }, [go, active]);
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      e.preventDefault();
      const w = wheel.current;
      clearTimeout(w.timer);
      w.timer = setTimeout(() => {
        w.locked = false;
        w.sum = 0;
      }, WHEEL_QUIET_MS);
      if (w.locked) return;
      w.sum += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      if (Math.abs(w.sum) < WHEEL_STEP) return;
      w.locked = true;
      w.go(w.active + (w.sum > 0 ? 1 : -1));
      w.sum = 0;
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [hasShorts]);

  const closeComments = useCallback(() => setComments(null), []);

  if (shorts.length === 0) {
    return (
      <div className="flex h-[calc(100dvh-56px)] flex-col items-center justify-center px-6 text-center" data-shorts-feed="empty">
        <h1 className="text-[20px] font-normal text-text">No Snips yet</h1>
        <p className="mt-2 max-w-[420px] text-[14px] leading-5 text-text-2">
          Vertical videos of a minute or less show up here once they are processed. Upload one from a phone.
        </p>
      </div>
    );
  }

  return (
    <div className="relative bg-black tab:bg-page" data-shorts-feed="ready" data-shorts-count={shorts.length} data-shorts-active={activeId}>
      <div
        ref={scroller}
        className={`h-[calc(100dvh-56px)] snap-y snap-mandatory overflow-y-scroll overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${comments ? "tab:pr-[436px]" : ""}`}
      >
        {shorts.map((s, i) => (
          <section
            key={s.id}
            data-short={s.id}
            data-index={i}
            data-short-active={i === active ? "true" : undefined}
            aria-label={s.title}
            className="flex h-full snap-start snap-always items-center justify-center tab:py-4"
          >
            <div className="relative h-full w-full overflow-hidden bg-black tab:aspect-[9/16] tab:w-auto tab:max-w-full tab:rounded-lg">
              {Math.abs(i - active) <= 1 ? (
                <ShortPlayer short={s} active={i === active} muted={muted} pings={likesOn} onUnmute={() => setMuted(false)} />
              ) : (
                <div className="absolute inset-0 bg-black" />
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/70 to-transparent" />
              <div className="absolute bottom-5 left-4 right-20 text-white" data-short-meta>
                <h2 className="line-clamp-2 text-[15px] font-medium leading-5 [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">{s.title}</h2>
                <Link href={`/@${s.channel.handle}`} className="mt-2 flex w-fit items-center gap-2 text-[14px] font-medium" data-short-channel>
                  <Avatar name={s.channel.name} url={s.channel.avatarUrl} size={24} />
                  <span className="truncate [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">@{s.channel.handle}</span>
                </Link>
                <p className="mt-1 text-[12px] text-white/80">{viewsLabel(s.views)}</p>
              </div>
              <div className="absolute bottom-5 right-2">
                <ShortRail
                  short={s}
                  likesOn={likesOn}
                  commentsOpen={comments?.id === s.id}
                  onComments={() => setComments((c) => (c?.id === s.id ? null : s))}
                  onShare={() => setShare(s)}
                />
              </div>
            </div>
          </section>
        ))}
        <section data-index={shorts.length} className="flex h-full snap-start items-center justify-center px-6 text-center" data-shorts-end>
          <p className="text-[14px] text-text-2">{next ? "Loading more Snips" : "You're all caught up. That's every Snip for now."}</p>
        </section>
      </div>

      <div className="absolute right-6 top-1/2 hidden -translate-y-1/2 flex-col gap-4 tab:flex" style={comments ? { right: 460 } : undefined}>
        <button
          type="button"
          aria-label="Previous Snip"
          data-shorts-prev
          disabled={active === 0}
          onClick={() => go(active - 1)}
          className="grid h-12 w-12 place-items-center rounded-full bg-hover text-text hover:bg-active disabled:opacity-40"
        >
          <ArrowDropUpIcon className="h-8 w-8" />
        </button>
        <button
          type="button"
          aria-label="Next Snip"
          data-shorts-next
          disabled={active >= shorts.length - 1 && !next}
          onClick={() => go(active + 1)}
          className="grid h-12 w-12 place-items-center rounded-full bg-hover text-text hover:bg-active disabled:opacity-40"
        >
          <ArrowDropDownIcon className="h-8 w-8" />
        </button>
      </div>

      {comments && <CommentsSheet short={comments} onClose={closeComments} />}
      {share && <ShareDialog videoId={share.id} title={share.title} path={`/shorts/${share.id}`} onClose={() => setShare(null)} />}
    </div>
  );
}
