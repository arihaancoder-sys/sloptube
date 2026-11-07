import Link from "next/link";
import { FeedGrid } from "@/components/feed/FeedGrid";
import { VideoCard, videoGridClass } from "@/components/VideoCard";
import { feedState } from "@/lib/feed/server";
import type { Channel } from "@/lib/channels/types";
import { NoVideos } from "./ChannelHeader";

/** The Home tab shows this many of the newest uploads. */
export const CHANNEL_HOME_COUNT = 8;

const frame = "mx-auto max-w-[1284px] px-0 py-6 sm:px-6";

/**
 * The real tab content from feed_videos('channel'), newest first, with the
 * same cards as the home grid. Home: the latest 8 under "Uploads". Videos:
 * every public video, with infinite scroll. With the feed flag off it stays
 * "This channel has no videos yet", like before.
 */
export async function ChannelVideos({ channel, tab, isOwner }: { channel: Channel; tab: "home" | "videos"; isOwner?: boolean }) {
  const state = await feedState("channel", {
    channelId: channel.id,
    limit: tab === "home" ? CHANNEL_HOME_COUNT : undefined,
  });
  if (state.kind !== "ready" || state.page.cards.length === 0) {
    return (
      <div data-channel-videos={state.kind === "ready" ? "empty" : state.kind}>
        <NoVideos isOwner={isOwner} />
      </div>
    );
  }
  const { now } = state;
  if (tab === "home") {
    return (
      <section className={frame} data-channel-videos="home">
        <h2 className="mb-4 flex items-baseline gap-4 px-3 text-[16px] font-normal leading-[22px] text-text sm:px-0">
          Uploads
          <Link href={`/@${channel.handle}/videos`} className="text-[14px] font-medium uppercase text-text-2 hover:text-text">
            See all
          </Link>
        </h2>
        <div className={videoGridClass}>
          {state.page.cards.map((c) => (
            <VideoCard key={c.id} video={c} now={now} />
          ))}
        </div>
      </section>
    );
  }
  return (
    <section className={frame} data-channel-videos="videos">
      <FeedGrid kind="channel" channelId={channel.id} initial={state.page} now={now} />
    </section>
  );
}
