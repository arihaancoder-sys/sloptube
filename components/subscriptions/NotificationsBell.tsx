"use client";

import Link from "next/link";
import { Thumb } from "@/components/Thumb";
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { BellIcon } from "@/components/icons";
import { Menu } from "@/components/Menu";
import type { FeedCard, FeedPage } from "@/lib/feed/types";
import { badgeLabel, parseSeen, SEEN_KEY, seenStamp, unreadCount } from "@/lib/subscriptions/unread";
import { timeAgo } from "@/lib/watch/format";

function readSeen(): number | null {
  if (typeof window === "undefined") return null;
  try {
    return parseSeen(localStorage.getItem(SEEN_KEY));
  } catch {
    return null;
  }
}

function writeSeen(value: number) {
  try {
    localStorage.setItem(SEEN_KEY, String(value));
  } catch {
    // Private windows and blocked storage: the badge just comes back next time.
  }
}

async function fetchNotifications(): Promise<FeedCard[]> {
  const res = await fetch("/api/subscriptions/feed?notify=1", { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return ((await res.json()) as FeedPage).cards;
}

/**
 * The bell in the top bar: the last 20 uploads from channels with the bell
 * on, newest first. The red badge counts the ones since the menu was last
 * opened in this browser (kept in localStorage). No push yet, just the list.
 */
export function NotificationsBell() {
  const [items, setItems] = useState<FeedCard[] | null>(null);
  const [failed, setFailed] = useState(false);
  // localStorage is only there in the browser; the badge waits for the list anyway.
  const [seen, setSeen] = useState<number | null>(readSeen);
  // What "seen" was when the menu opened, so the new rows keep their dot while it is open.
  const [seenAtOpen, setSeenAtOpen] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  const refresh = useCallback(() => {
    return fetchNotifications().then(
      (cards) => {
        setItems(cards);
        setFailed(false);
        setNow(Date.now());
        return cards;
      },
      () => {
        setFailed(true);
        return null;
      },
    );
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const unread = items ? unreadCount(items, seen) : 0;
  const badge = badgeLabel(unread);

  function opened() {
    setSeenAtOpen(seen);
    const mark = (list: FeedCard[]) => {
      const stamp = seenStamp(list, Date.now());
      writeSeen(stamp);
      setSeen(stamp);
    };
    mark(items ?? []);
    void refresh().then((list) => list && mark(list));
  }

  return (
    <Menu
      label={badge ? `Notifications, ${unread} new` : "Notifications"}
      width={480}
      onOpen={opened}
      buttonClassName="relative hidden h-10 w-10 place-items-center rounded-full text-icon hover:bg-hover sm:grid"
      button={
        <>
          <BellIcon className="h-6 w-6" />
          {badge && (
            <span
              data-bell-badge={badge}
              className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-red px-1 text-center text-[11px] font-medium leading-4 text-white"
            >
              {badge}
            </span>
          )}
        </>
      }
    >
      {(close) => (
        <div data-notifications={items ? items.length : "loading"}>
          <div className="flex h-12 items-center border-b border-divider px-4 text-[16px] leading-[22px] text-text">
            Notifications
          </div>
          <div className="max-h-[min(640px,calc(100dvh-140px))] overflow-y-auto">
            {!items && !failed && (
              <div aria-hidden className="space-y-3 p-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex items-center gap-4">
                    <span className="h-12 w-12 shrink-0 rounded-full bg-skeleton" />
                    <span className="h-4 flex-1 bg-skeleton" />
                    <span className="h-12 w-[86px] shrink-0 bg-skeleton" />
                  </div>
                ))}
              </div>
            )}
            {failed && !items && <p className="px-4 py-6 text-[14px] text-text-2">Couldn&apos;t load your notifications.</p>}
            {items && items.length === 0 && (
              <div className="flex flex-col items-center px-8 py-12 text-center">
                <BellIcon className="h-[72px] w-[72px] text-text-3" />
                <p className="mt-4 text-[16px] font-medium text-text">Your notifications live here</p>
                <p className="mt-2 text-[14px] leading-5 text-text-2">
                  Subscribe to channels and turn their bell on to hear about new uploads.
                </p>
              </div>
            )}
            {items?.map((v) => {
              const fresh = seenAtOpen === null || Date.parse(v.publishedAt) > seenAtOpen;
              return (
                <Link
                  key={v.id}
                  href={`/watch?v=${v.id}`}
                  onClick={close}
                  role="menuitem"
                  data-notification={v.id}
                  data-unread={fresh ? "1" : undefined}
                  className="relative flex items-start gap-4 py-4 pl-8 pr-4 hover:bg-hover"
                >
                  {fresh && <span aria-hidden className="absolute left-3 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-[var(--link)]" />}
                  <Avatar name={v.channel.name} url={v.channel.avatarUrl} size={48} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-3 text-[14px] leading-5 text-text">
                      {v.channel.name} uploaded: {v.title}
                    </span>
                    <span className="mt-1 block text-[13px] leading-[18px] text-text-2">{timeAgo(v.publishedAt, now || Date.now())}</span>
                  </span>
                  <span className="relative h-12 w-[86px] shrink-0 overflow-hidden rounded-sm bg-skeleton">
                    <Thumb src={v.thumbnail} alt="" sizes="86px" />
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </Menu>
  );
}
