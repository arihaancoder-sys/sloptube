import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ChannelMessage } from "@/components/channel/ChannelNotices";
import { StatsError, StatsNotSetUp, StatsOff } from "@/components/studio/analytics/StatsNotices";
import { VideoAnalyticsView } from "@/components/studio/analytics/VideoAnalyticsView";
import { PreviewNotice, StudioNoDb, StudioOff, StudioPage, StudioSkeleton } from "@/components/studio/StudioNotices";
import { parseRange, statsErrorMessage } from "@/lib/stats/rules";
import { videoAnalytics } from "@/lib/stats/server";
import { UUID } from "@/lib/studio/http";

export const metadata = { title: "Video analytics | sloptube" };

async function VideoAnalyticsGate({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const range = parseRange((await searchParams).range);
  const state = await videoAnalytics(id.toLowerCase(), range);
  switch (state.kind) {
    case "off":
      return <StudioOff />;
    case "stats-off":
      return <StatsOff />;
    case "no-db":
      return <StudioNoDb />;
    case "not-set-up":
      return <StatsNotSetUp />;
    case "signed-out":
      redirect(`/login?next=/studio/video/${id}/analytics`);
    case "missing":
      return (
        <div data-studio-state="missing">
          <ChannelMessage state="missing" title="This video isn't in your content">
            It may have been deleted for good, or it belongs to another channel.
          </ChannelMessage>
        </div>
      );
    case "error":
      return <StatsError message={statsErrorMessage(state.code)} />;
    case "ready":
      return (
        <StudioPage wide>
          <div data-studio-state="ready">
            {state.preview && <PreviewNotice />}
            <VideoAnalyticsView data={state.data} realtime={state.realtime} live={!state.preview} />
          </div>
        </StudioPage>
      );
  }
}

export default function VideoAnalyticsPage({ params, searchParams }: PageProps<"/studio/video/[id]/analytics">) {
  return (
    <Suspense
      fallback={
        <StudioPage wide>
          <StudioSkeleton />
        </StudioPage>
      }
    >
      <VideoAnalyticsGate params={params} searchParams={searchParams} />
    </Suspense>
  );
}
