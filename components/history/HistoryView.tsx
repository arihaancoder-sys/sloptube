import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { AccountCircleIcon, HistoryIcon } from "@/components/icons";
import { historyPage } from "@/lib/engagement/server";
import { HistoryList } from "./HistoryList";
import { HistoryRowSkeleton } from "./HistoryRow";

const frame = "mx-auto max-w-[1284px] pb-6 search:px-6";

export function HistorySkeleton() {
  return (
    <div className={frame} data-history-state="loading">
      <div className="mx-3 mb-4 mt-6 h-5 w-32 bg-skeleton search:mx-0" />
      <div className="flex max-w-[860px] flex-col gap-4">
        <HistoryRowSkeleton />
        <HistoryRowSkeleton />
        <HistoryRowSkeleton />
      </div>
    </div>
  );
}

/**
 * /feed/history: the signed in person's watch history, most recent first,
 * like the 2019 page. Reads the request, so it is rendered inside <Suspense>.
 */
export async function HistoryView() {
  const state = await historyPage();
  switch (state.kind) {
    case "off":
    case "no-db":
      return (
        <div data-history-state={state.kind}>
          <EmptyState title="No watch history yet." hint="Watch history isn't switched on yet." cards={0} />
        </div>
      );
    case "not-set-up":
      return (
        <div data-history-state="not-set-up">
          <EmptyState
            title="Watch history isn't set up yet."
            hint="Run supabase/migrations/011_engagement.sql in the Supabase SQL editor."
            cards={0}
          />
        </div>
      );
    case "signed-out":
      return (
        <div data-history-state="signed-out" className="flex flex-col items-center px-6 py-20 text-center">
          <HistoryIcon className="h-[120px] w-[120px] text-text-3" />
          <h1 className="mt-6 text-[24px] font-normal leading-8 text-text">Keep track of what you watch</h1>
          <p className="mt-2 max-w-[420px] text-[14px] leading-5 text-text-2">Watch history isn&apos;t viewable when signed out.</p>
          <Link
            href="/login?next=%2Ffeed%2Fhistory"
            className="mt-6 inline-flex h-9 items-center gap-2 rounded-[2px] border border-[var(--link)] px-[11px] text-[14px] font-medium uppercase text-[var(--link)]"
          >
            <AccountCircleIcon className="h-6 w-6" />
            Sign in
          </Link>
        </div>
      );
    case "ready":
      return (
        <div className={frame} data-history-state="ready">
          <HistoryList initial={state.page} paused={state.paused} now={state.now} />
        </div>
      );
  }
}
