import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ChannelAnalyticsView } from "@/components/studio/analytics/ChannelAnalyticsView";
import { StatsError, StatsNotSetUp, StatsOff } from "@/components/studio/analytics/StatsNotices";
import { PreviewNotice, StudioNoDb, StudioOff, StudioPage, StudioSkeleton } from "@/components/studio/StudioNotices";
import { parseRange, statsErrorMessage } from "@/lib/stats/rules";
import { channelAnalytics } from "@/lib/stats/server";

export const metadata = { title: "Channel analytics | sloptube" };

async function AnalyticsGate({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const range = parseRange((await searchParams).range);
  const state = await channelAnalytics(range);
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
      redirect(`/login?next=/studio/analytics`);
    case "error":
      return <StatsError message={statsErrorMessage(state.code)} />;
    case "ready":
      return (
        <StudioPage wide>
          <div data-studio-state="ready">
            {state.preview && <PreviewNotice />}
            <ChannelAnalyticsView data={state.data} realtime={state.realtime} live={!state.preview} />
          </div>
        </StudioPage>
      );
  }
}

export default function StudioAnalyticsPage({ searchParams }: PageProps<"/studio/analytics">) {
  return (
    <Suspense
      fallback={
        <StudioPage wide>
          <StudioSkeleton />
        </StudioPage>
      }
    >
      <AnalyticsGate searchParams={searchParams} />
    </Suspense>
  );
}
