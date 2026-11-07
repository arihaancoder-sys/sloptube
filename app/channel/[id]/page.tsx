import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ChannelMissing, ChannelSkeleton, ChannelsNotSetUp, ChannelsOff } from "@/components/channel/ChannelNotices";
import { handleForChannelId } from "@/lib/channels/server";

export const metadata = { title: "Channel | sloptube" };

/** /channel/<id> always sends people on to the channel's /@handle. */
async function ChannelRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = await handleForChannelId(id);
  switch (state.kind) {
    case "handle":
      redirect(`/@${state.handle}`);
    case "off":
      return <ChannelsOff />;
    case "not-set-up":
      return <ChannelsNotSetUp />;
    case "no-db":
      redirect("/@someone");
    default:
      return <ChannelMissing />;
  }
}

export default function ChannelByIdPage({ params }: PageProps<"/channel/[id]">) {
  return (
    <Suspense fallback={<ChannelSkeleton />}>
      <ChannelRedirect params={params} />
    </Suspense>
  );
}
