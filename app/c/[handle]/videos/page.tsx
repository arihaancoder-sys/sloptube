import { Suspense } from "react";
import { ChannelSkeleton } from "@/components/channel/ChannelNotices";
import { ChannelView } from "@/components/channel/ChannelView";
import { channelPageMetadata } from "@/lib/seo/pages";

// Served at /@handle/videos (see the rewrites in next.config.ts).

export async function generateMetadata({ params }: PageProps<"/c/[handle]/videos">) {
  return channelPageMetadata((await params).handle, "videos");
}

export default function ChannelVideosPage({ params }: PageProps<"/c/[handle]/videos">) {
  return (
    <Suspense fallback={<ChannelSkeleton />}>
      <ChannelView params={params} tab="videos" />
    </Suspense>
  );
}
