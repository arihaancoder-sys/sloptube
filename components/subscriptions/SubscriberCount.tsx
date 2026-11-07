"use client";

import { formatSubscribers } from "@/lib/channels/validation";
import { useSubscriptions } from "@/lib/store/subscriptions";
import { viewToggle } from "@/lib/subscriptions/toggle";

/**
 * "1.2K subscribers", live: it follows the Subscribe button for the same
 * channel on this page. Before any click it shows what the server rendered.
 */
export function SubscriberCount({ channelId, count }: { channelId: string; count: number }) {
  const live = useSubscriptions((s) => {
    const t = s.toggles[channelId];
    return t ? viewToggle(t).count : null;
  });
  return <span data-sub-count={live ?? count}>{formatSubscribers(live ?? count)}</span>;
}
