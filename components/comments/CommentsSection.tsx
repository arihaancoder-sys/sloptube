"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { AccountCircleIcon, SortIcon } from "@/components/icons";
import { Menu } from "@/components/Menu";
import { commentsHeader, POLL_MS, type CommentSort } from "@/lib/comments/rules";
import { pillLabel } from "@/lib/comments/thread";
import type { CommentsInitial } from "@/lib/comments/types";
import { useComments } from "@/lib/store/comments";
import { useSession } from "@/lib/store/session";
import { CommentBox } from "./CommentBox";
import { CommentItem, type CommentContext } from "./CommentItem";

const SORTS: { value: CommentSort; label: string }[] = [
  { value: "top", label: "Top comments" },
  { value: "newest", label: "Newest first" },
];

function SortMenu() {
  const sort = useComments((s) => s.sort);
  const setSort = useComments((s) => s.setSort);
  return (
    <Menu
      label="Sort comments"
      width={180}
      buttonClassName="flex h-9 items-center gap-2 rounded-sm px-2 text-[14px] font-medium uppercase tracking-[0.007px] text-text-2 hover:text-text"
      button={
        <span className="flex items-center gap-2" data-sort-button>
          <SortIcon className="h-6 w-6 text-icon" />
          Sort by
        </span>
      }
    >
      {(close) => (
        <div role="none" data-sort-menu>
          {SORTS.map((s) => (
            <button
              key={s.value}
              type="button"
              role="menuitemradio"
              aria-checked={sort === s.value}
              data-sort={s.value}
              onClick={() => {
                close();
                void setSort(s.value);
              }}
              className={`flex h-12 w-full items-center px-4 text-left text-[14px] text-text hover:bg-hover ${sort === s.value ? "bg-active" : ""}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </Menu>
  );
}

function Skeleton() {
  return (
    <div className="mt-4 flex gap-4" aria-hidden data-comments-loading>
      <span className="h-10 w-10 shrink-0 rounded-full bg-skeleton" />
      <div className="flex-1 pt-1">
        <div className="h-3 w-40 rounded-sm bg-skeleton" />
        <div className="mt-2 h-3 w-4/5 rounded-sm bg-skeleton" />
      </div>
    </div>
  );
}

/** The comments section, server rendered with the first page, below the description. */
export function CommentsSection({
  videoId,
  initial,
  channel,
}: {
  videoId: string;
  initial: CommentsInitial;
  channel: { name: string; avatarUrl: string | null };
}) {
  const router = useRouter();
  const init = useComments((s) => s.init);
  const ready = useComments((s) => s.videoId === videoId);
  const thread = useComments((s) => s.thread);
  const loadingMore = useComments((s) => s.loadingMore);
  const loadMore = useComments((s) => s.loadMore);
  const poll = useComments((s) => s.poll);
  const showNew = useComments((s) => s.showNew);
  const post = useComments((s) => s.post);
  const user = useSession((s) => s.user);
  const [now, setNow] = useState(initial.now);
  const sentinel = useRef<HTMLDivElement>(null);
  const listTop = useRef<HTMLDivElement>(null);

  // Start the store for this video (again after a client side video switch).
  useEffect(() => {
    init(videoId, initial);
  }, [init, videoId, initial]);

  // "2 days ago" moves on while the page is open (it starts from the server's clock).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // The new comments poll, only while the tab is visible.
  useEffect(() => {
    if (!ready || initial.mode === "off") return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [ready, poll, initial.mode]);

  // Infinite scroll of top level comments.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !ready) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ready, loadMore, thread.next]);

  const signIn = () => {
    const here = window.location.pathname + window.location.search;
    router.push(`/login?next=${encodeURIComponent(here)}`);
  };
  const signedIn = initial.signedIn && user !== null;
  const viewer = useMemo(
    () => (user ? { handle: user.channelHandle ?? user.username, name: user.displayName, avatarUrl: user.avatarUrl } : null),
    [user],
  );
  const ctx: CommentContext = { isOwner: initial.isOwner, signedIn: initial.signedIn, viewer, channel, now, signIn };

  // Before the store has this video, show the server's first page as is.
  const view = ready ? thread : { ...thread, count: initial.count, top: initial.page.comments, next: initial.page.next, held: [] };
  const pill = pillLabel(view.held.length);
  const off = initial.mode === "off";
  const held = initial.mode === "held" && !initial.isOwner;

  return (
    <section className="px-3 pb-8 pt-6 tab:px-0" data-comments data-comments-state={off ? "turned-off" : "ready"} aria-label="Comments">
      {off ? (
        <p className="border-t border-divider pt-6 text-center text-[14px] text-text-2" data-comments-off>
          Comments are turned off.
        </p>
      ) : (
        <>
          <div className="mb-6 flex items-center gap-6">
            <h2 className="text-[16px] font-normal leading-[22px] text-text" data-comments-count>
              {commentsHeader(view.count)}
            </h2>
            <SortMenu />
          </div>

          {held ? (
            <p className="mb-6 text-[14px] text-text-2" data-comments-held>
              The creator reviews comments before they show. Posting opens with moderation.
            </p>
          ) : initial.signedIn ? (
            <CommentBox
              avatarName={viewer?.name ?? "You"}
              avatarUrl={viewer?.avatarUrl}
              onSubmit={(body) => (viewer ? post(body, null, viewer, initial.isOwner) : false)}
            />
          ) : (
            <div className="flex items-center gap-4" data-comments-signed-out>
              <AccountCircleIcon className="h-10 w-10 shrink-0 text-icon" />
              <button
                type="button"
                onClick={signIn}
                className="min-w-0 flex-1 border-b border-divider pb-1 text-left text-[14px] leading-5 text-text-2"
              >
                Add a public comment...
              </button>
              <button type="button" onClick={signIn} className="shrink-0 rounded-sm border border-link px-3 py-1.5 text-[14px] font-medium uppercase text-link">
                Sign in
              </button>
            </div>
          )}

          <div ref={listTop} className="scroll-mt-16" />
          {pill && (
            <div className="sticky top-16 z-10 mt-4 flex justify-center">
              <button
                type="button"
                data-new-comments
                onClick={() => {
                  showNew();
                  listTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="rounded-full bg-link px-4 py-1.5 text-[13px] font-medium text-white shadow-md"
              >
                {pill}
              </button>
            </div>
          )}

          <div data-comment-list className="mt-2">
            {view.top.map((c) => (
              <CommentItem key={c.id} comment={c} ctx={{ ...ctx, signedIn }} />
            ))}
            {view.top.length === 0 && !loadingMore && (
              <p className="mt-6 text-[14px] text-text-2" data-comments-empty>
                No comments yet. Be the first to say something.
              </p>
            )}
            {loadingMore && <Skeleton />}
            <div ref={sentinel} data-comments-sentinel={view.next ? "more" : "end"} className="h-px" />
          </div>
        </>
      )}
    </section>
  );
}

/** The section without a database: a note where the comments would be. */
export function CommentsUnavailable() {
  return (
    <section className="px-3 pb-8 pt-6 tab:px-0" data-comments data-comments-state="no-db" aria-label="Comments">
      <h2 className="mb-4 text-[16px] text-text">Comments</h2>
      <div className="flex items-center gap-4">
        <Avatar name="?" size={40} />
        <div role="status" className="flex-1 rounded-sm border border-divider bg-surface px-4 py-3 text-[14px] leading-5 text-text">
          <p className="font-medium">database not connected</p>
          <p className="mt-1 text-text-2">Comments show here once the publishable key is set.</p>
        </div>
      </div>
    </section>
  );
}
