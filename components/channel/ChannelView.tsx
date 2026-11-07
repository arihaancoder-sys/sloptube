import { ChannelShorts } from "@/components/shorts/ChannelShorts";
import { channelByHandle } from "@/lib/channels/server";
import { flagOn } from "@/lib/flags";
import { previewChannel, type Channel } from "@/lib/channels/types";
import { ChannelAbout, ChannelHeader, NoVideos, type ChannelTab } from "./ChannelHeader";
import { ChannelDbNotice, ChannelMissing, ChannelsNotSetUp, ChannelsOff } from "./ChannelNotices";
import { ChannelVideos } from "./ChannelVideos";

function TabBody({ tab, channel, isOwner, live = false }: { tab: ChannelTab; channel: Channel; isOwner?: boolean; live?: boolean }) {
  if (tab === "about") return <ChannelAbout channel={channel} />;
  // Without a database (the preview channel) there is nothing to read.
  if (!live) return <NoVideos isOwner={isOwner} />;
  if (tab === "shorts") return <ChannelShorts channel={channel} isOwner={isOwner} />;
  return <ChannelVideos channel={channel} tab={tab} isOwner={isOwner} />;
}

/**
 * The public channel page for one tab. Reads the request (flags, session),
 * so it is rendered inside a <Suspense> boundary by the route.
 */
export async function ChannelView({ params, tab }: { params: Promise<{ handle: string }>; tab: ChannelTab }) {
  const { handle: segment } = await params;
  const state = await channelByHandle(segment);

  switch (state.kind) {
    case "off":
      return <ChannelsOff />;
    case "missing":
      return <ChannelMissing />;
    case "not-set-up":
      return <ChannelsNotSetUp />;
    case "no-db": {
      const channel = previewChannel(
        segment.replace(/^(%40|@)/, "").toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 30) || "someone",
      );
      return (
        <div data-channel-state="no-db">
          <ChannelDbNotice />
          <div className="mt-4">
            <ChannelHeader channel={channel} tab={tab} />
          </div>
          <TabBody tab={tab} channel={channel} />
        </div>
      );
    }
    case "ready": {
      const shorts = await flagOn("shorts");
      return (
        <div data-channel-state="ready">
          <ChannelHeader channel={state.channel} tab={tab} isOwner={state.isOwner} shorts={shorts} />
          <TabBody tab={tab} channel={state.channel} isOwner={state.isOwner} live />
        </div>
      );
    }
  }
}
