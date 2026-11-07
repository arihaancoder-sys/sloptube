"use client";

import { useEffect, useState } from "react";
import { CommentsSection } from "@/components/comments/CommentsSection";
import { CloseIcon } from "@/components/icons";
import type { CommentsInitial } from "@/lib/comments/types";
import type { Short } from "@/lib/shorts/types";

type Loaded = { id: string; comments: CommentsInitial | null } | { id: string; error: true };

/**
 * The comments of one short in a sheet: on the right of the player on
 * desktop, from the bottom on phones. Inside is the watch page's comments
 * section from feature 10, started from /api/shorts/comments.
 */
export function CommentsSheet({ short, onClose }: { short: Short; onClose: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let stop = false;
    fetch(`/api/shorts/comments?v=${short.id}`)
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as { comments?: CommentsInitial | null };
        if (!stop) setLoaded(r.ok ? { id: short.id, comments: body.comments ?? null } : { id: short.id, error: true });
      })
      .catch(() => !stop && setLoaded({ id: short.id, error: true }));
    return () => {
      stop = true;
    };
  }, [short.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const current = loaded && loaded.id === short.id ? loaded : null;

  return (
    <>
      <div aria-hidden onClick={onClose} className="fixed inset-0 z-40 bg-black/40 tab:hidden" />
      <aside
        role="dialog"
        aria-label="Comments"
        data-comments-sheet={current ? ("error" in current ? "error" : current.comments ? "ready" : "off") : "loading"}
        className="fixed inset-x-0 bottom-0 z-50 flex h-[72dvh] flex-col rounded-t-xl bg-surface shadow-[var(--menu-shadow)] tab:inset-x-auto tab:bottom-4 tab:right-4 tab:top-[72px] tab:h-auto tab:w-[420px] tab:rounded-lg"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-divider pl-4 pr-2">
          <span aria-hidden className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-[var(--active)] tab:hidden" />
          <h2 className="text-[16px] font-medium text-text">Comments</h2>
          <button type="button" aria-label="Close comments" onClick={onClose} data-comments-sheet-close className="grid h-10 w-10 place-items-center text-icon">
            <CloseIcon className="h-6 w-6" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 [&_[data-comments]]:pt-2 [&_.sticky]:top-2">
          {!current && (
            <div className="mt-6 space-y-4" aria-hidden>
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-4">
                  <span className="h-10 w-10 shrink-0 rounded-full bg-skeleton" />
                  <div className="flex-1 pt-1">
                    <div className="h-3 w-40 rounded-sm bg-skeleton" />
                    <div className="mt-2 h-3 w-4/5 rounded-sm bg-skeleton" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {current && "error" in current && <p className="mt-6 text-[14px] text-text-2">Comments could not be loaded. Close this and try again.</p>}
          {current && !("error" in current) && !current.comments && (
            <p className="mt-6 text-[14px] text-text-2" data-comments-sheet-off>
              Comments aren&apos;t on yet.
            </p>
          )}
          {current && !("error" in current) && current.comments && (
            <CommentsSection
              videoId={short.id}
              initial={current.comments}
              channel={{ name: short.channel.name, avatarUrl: short.channel.avatarUrl }}
            />
          )}
        </div>
      </aside>
    </>
  );
}
