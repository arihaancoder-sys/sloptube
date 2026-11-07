import { redirect } from "next/navigation";
import { ChannelMessage } from "@/components/channel/ChannelNotices";
import { EmptyState } from "@/components/EmptyState";
import { shortsState } from "@/lib/shorts/server";
import { ShortsFeed } from "./ShortsFeed";

/** The placeholder /shorts showed before feature 11, kept while the flag is off. */
export function ShortsComingSoon({ state }: { state: string }) {
  return (
    <div data-shorts-state={state}>
      <EmptyState title="No Snips yet." hint="Check back soon." />
    </div>
  );
}

/** While the first page loads: a black column in the shape of a short. */
export function ShortsSkeleton() {
  return (
    <div className="flex h-[calc(100dvh-56px)] items-center justify-center bg-black tab:bg-page tab:py-4" data-shorts-state="loading" aria-hidden>
      <div className="h-full w-full bg-[#202020] tab:aspect-[9/16] tab:w-auto tab:rounded-lg" />
    </div>
  );
}

/**
 * /shorts and /shorts/<id>. With the shorts flag off (or no database) the
 * "No Snips yet" placeholder stays. A deep link to a regular video goes on
 * to /watch. Reads the request, so it is rendered inside <Suspense>.
 */
export async function ShortsView({ startId = null }: { startId?: string | null }) {
  const state = await shortsState(startId);
  switch (state.kind) {
    case "off":
    case "no-db":
      return <ShortsComingSoon state={state.kind} />;
    case "not-set-up":
      return (
        <div data-shorts-state="not-set-up">
          <EmptyState title="Snips aren't set up yet." hint="Run supabase/migrations/013_shorts.sql in the Supabase SQL editor." />
        </div>
      );
    case "not-a-short":
      redirect(`/watch?v=${state.id}`);
    case "missing":
      return (
        <div data-shorts-state="missing">
          <ChannelMessage state="missing" title="This Snip isn't available">
            It may have been removed or made private. There are more on the Snips page.
          </ChannelMessage>
        </div>
      );
    case "ready":
      return <ShortsFeed start={state.start} initial={state.page} />;
  }
}
