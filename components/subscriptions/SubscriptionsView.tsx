import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { FeedGrid } from "@/components/feed/FeedGrid";
import { AccountCircleIcon, SubscriptionsIcon } from "@/components/icons";
import { SkeletonRow, videoGridClass } from "@/components/VideoCard";
import { subscriptionsFeed } from "@/lib/subscriptions/server";

const frame = "mx-auto max-w-[2200px] px-0 py-6 sm:px-6";

/** The big grey icon with a line or two under it, like the 2019 empty pages. */
function Notice({ state, title, text, children }: { state: string; title: string; text: string; children?: React.ReactNode }) {
  return (
    <div data-subs-state={state} className="flex flex-col items-center px-6 py-20 text-center">
      <SubscriptionsIcon className="h-[120px] w-[120px] text-text-3" />
      <h1 className="mt-6 text-[24px] font-normal leading-8 text-text">{title}</h1>
      <p className="mt-2 max-w-[420px] text-[14px] leading-5 text-text-2">{text}</p>
      {children}
    </div>
  );
}

export function SubscriptionsSkeleton() {
  return (
    <div className={frame} data-subs-state="loading">
      <div className="mb-4 h-5 w-24 bg-skeleton" />
      <div className={videoGridClass}>
        <SkeletonRow />
        <SkeletonRow />
      </div>
    </div>
  );
}

/**
 * /feed/subscriptions: uploads from the channels the person subscribes to,
 * under Today, This week and Older. Reads the request, so it is rendered
 * inside <Suspense>.
 */
export async function SubscriptionsView() {
  const state = await subscriptionsFeed();
  switch (state.kind) {
    case "off":
    case "no-db":
      return (
        <div data-subs-state={state.kind}>
          <EmptyState title="No subscriptions yet." hint="Subscriptions aren't switched on yet." />
        </div>
      );
    case "signed-out":
      return (
        <Notice
          state="signed-out"
          title="Don't miss new videos"
          text="Sign in to see updates from channels you subscribe to."
        >
          <Link
            href="/login?next=%2Ffeed%2Fsubscriptions"
            className="mt-6 inline-flex h-9 items-center gap-2 rounded-[2px] border border-[var(--link)] px-[11px] text-[14px] font-medium uppercase text-[var(--link)]"
          >
            <AccountCircleIcon className="h-6 w-6" />
            Sign in
          </Link>
        </Notice>
      );
    case "not-set-up":
      return (
        <div data-subs-state="not-set-up">
          <EmptyState
            title="Subscriptions aren't set up yet."
            hint="Run supabase/migrations/009_subscriptions.sql in the Supabase SQL editor."
          />
        </div>
      );
    case "ready":
      if (state.page.cards.length === 0) {
        return (
          <Notice
            state="empty"
            title="No new videos"
            text="Subscribe to channels and their new uploads show up here."
          >
            <Link href="/" className="btn-blue mt-6">
              Browse videos
            </Link>
          </Notice>
        );
      }
      return (
        <div className={frame} data-subs-state="ready">
          <FeedGrid kind="subscriptions" initial={state.page} now={state.now} />
        </div>
      );
  }
}
