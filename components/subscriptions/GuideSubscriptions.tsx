"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { useSubscriptions } from "@/lib/store/subscriptions";
import { useClientNow } from "@/lib/subscriptions/client-clock";
import { guideSlice } from "@/lib/subscriptions/rules";
import { hasNewUpload } from "@/lib/subscriptions/unread";

function ExpandIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="mr-6 h-6 w-6 shrink-0 text-icon" fill="currentColor">
      <path d={open ? "M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" : "M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"} />
    </svg>
  );
}

/**
 * The guide's SUBSCRIPTIONS section, 2019 style: picture and name per channel,
 * a small blue dot for an upload in the last 7 days, seven channels and then
 * SHOW MORE. Only rendered for signed in people with the flag on.
 */
export function GuideSubscriptions({ onNavigate }: { onNavigate?: () => void }) {
  const status = useSubscriptions((s) => s.status);
  const channels = useSubscriptions((s) => s.channels);
  const [expanded, setExpanded] = useState(false);
  // The dot needs the clock, which differs between the server and the browser.
  const now = useClientNow();

  const { shown, more } = guideSlice(channels, expanded);

  return (
    <div data-guide-subs={status} data-guide-subs-count={channels.length}>
      <h2 className="px-6 py-2 text-[14px] font-medium uppercase text-text-2">Subscriptions</h2>
      {status !== "ready" && status !== "error" && (
        <div aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex h-10 items-center px-6">
              <span className="mr-6 h-6 w-6 shrink-0 rounded-full bg-skeleton" />
              <span className="h-3 w-28 bg-skeleton" />
            </div>
          ))}
        </div>
      )}
      {status === "error" && <p className="px-6 py-2 text-[13px] text-text-2">Couldn&apos;t load your subscriptions.</p>}
      {status === "ready" && channels.length === 0 && (
        <p className="px-6 py-2 text-[13px] leading-[18px] text-text-2">Channels you subscribe to show up here.</p>
      )}
      {shown.map((c) => (
        <Link
          key={c.id}
          href={`/@${c.handle}`}
          onClick={onNavigate}
          className="flex h-10 items-center px-6 text-[14px] hover:bg-hover"
          data-guide-channel={c.handle}
        >
          <span className="mr-6 shrink-0">
            <Avatar name={c.name} url={c.avatarUrl} size={24} />
          </span>
          <span className="min-w-0 flex-1 truncate">{c.name}</span>
          {now !== null && hasNewUpload(c.latestUploadAt, now) && (
            <span
              className="ml-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--link)]"
              title="New videos"
              aria-label="New videos"
              data-guide-new
            />
          )}
        </Link>
      ))}
      {(more > 0 || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex h-10 w-full items-center px-6 text-left text-[14px] uppercase text-text hover:bg-hover"
          data-guide-more
        >
          <ExpandIcon open={expanded} />
          {expanded ? "Show less" : `Show ${more} more`}
        </button>
      )}
    </div>
  );
}
