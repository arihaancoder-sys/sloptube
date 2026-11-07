import { Suspense } from "react";
import { ChannelSkeleton } from "@/components/channel/ChannelNotices";
import { ChannelView } from "@/components/channel/ChannelView";
import { channelPageMetadata } from "@/lib/seo/pages";

// Served at /@handle (see the rewrites in next.config.ts).

export async function generateMetadata({ params }: PageProps<"/c/[handle]">) {
  return channelPageMetadata((await params).handle, "home");
}

export default function ChannelHomePage({ params }: PageProps<"/c/[handle]">) {
  return (
    <Suspense fallback={<ChannelSkeleton />}>
      <ChannelView params={params} tab="home" />
    </Suspense>
  );
}
