import { NoVideos } from "@/components/channel/ChannelHeader";
import { FeedGrid } from "@/components/feed/FeedGrid";
import type { Channel } from "@/lib/channels/types";
import { feedState } from "@/lib/feed/server";
import { CHANNEL_SHORTS_PAGE } from "@/lib/shorts/rules";

/**
 * A channel's Snips tab: its public shorts, newest first, in a 9:16 grid
 * with infinite scroll (feed_videos('channel_shorts'), migration 013). With
 * the shorts flag off the tab is hidden and this says there is nothing.
 */
export async function ChannelShorts({ channel, isOwner }: { channel: Channel; isOwner?: boolean }) {
  const state = await feedState("channel_shorts", { channelId: channel.id, limit: CHANNEL_SHORTS_PAGE });
  if (state.kind !== "ready" || state.page.cards.length === 0) {
    return (
      <div data-channel-shorts={state.kind === "ready" ? "empty" : state.kind}>
        <NoVideos isOwner={isOwner} />
      </div>
    );
  }
  return (
    <section className="mx-auto max-w-[1284px] px-0 py-6 sm:px-6" data-channel-shorts="ready">
      <FeedGrid kind="channel_shorts" channelId={channel.id} initial={state.page} now={state.now} />
    </section>
  );
}
