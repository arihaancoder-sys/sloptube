import { Suspense } from "react";
import { ChannelSkeleton } from "@/components/channel/ChannelNotices";
import { ChannelView } from "@/components/channel/ChannelView";
import { channelPageMetadata } from "@/lib/seo/pages";

// Served at /@handle/about (see the rewrites in next.config.ts).

export async function generateMetadata({ params }: PageProps<"/c/[handle]/about">) {
  return channelPageMetadata((await params).handle, "about");
}

export default function ChannelAboutPage({ params }: PageProps<"/c/[handle]/about">) {
  return (
    <Suspense fallback={<ChannelSkeleton />}>
      <ChannelView params={params} tab="about" />
    </Suspense>
  );
}
