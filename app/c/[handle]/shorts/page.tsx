import { Suspense } from "react";
import { ChannelSkeleton } from "@/components/channel/ChannelNotices";
import { ChannelView } from "@/components/channel/ChannelView";
import { channelPageMetadata } from "@/lib/seo/pages";

// Served at /@handle/shorts (see the rewrites in next.config.ts).

export async function generateMetadata({ params }: PageProps<"/c/[handle]/shorts">) {
  return channelPageMetadata((await params).handle, "shorts");
}

export default function ChannelShortsPage({ params }: PageProps<"/c/[handle]/shorts">) {
  return (
    <Suspense fallback={<ChannelSkeleton />}>
      <ChannelView params={params} tab="shorts" />
    </Suspense>
  );
}
