import Link from "next/link";
import { SpritePreview } from "@/components/feed/SpritePreview";
import { viewsLabel } from "@/lib/feed/format";
import type { FeedCard } from "@/lib/feed/types";
import { formatTime, timeAgo } from "@/lib/watch/format";
import { Avatar } from "./Avatar";
import { GRID_SIZES, Thumb } from "./Thumb";
import { ThumbProgress } from "./ThumbProgress";

// No "use client" on purpose: the server pages and the client grid both use
// these, and videoGridClass must stay a plain string for server components.

/**
 * A video in the home grid, 2019 style: 16:9 thumbnail with the duration in
 * the bottom right, channel avatar left of a two line title, grey meta line.
 * On phones the meta is one line ("channel · 1.2K views · 3 days ago"), from
 * two columns up the channel gets its own line like the desktop site.
 * `now` comes from the server so the "ago" text matches after hydration.
 * `eager`: the first row, which is on screen right away (the LCP image).
 */
export function VideoCard({
  video,
  now,
  rank,
  eager = false,
  heading: Heading = "h3",
}: {
  video: FeedCard;
  now: number;
  rank?: number;
  eager?: boolean;
  /** h2 right under the page's h1 (home, trending), h3 under a section header. */
  heading?: "h2" | "h3";
}) {
  const href = `/watch?v=${video.id}`;
  const channelHref = `/@${video.channel.handle}`;
  return (
    <article className="min-w-0" data-feed-card={video.id}>
      <Link href={href} className="relative block aspect-video overflow-hidden bg-skeleton" tabIndex={-1} aria-hidden>
        <Thumb src={video.thumbnail} alt={video.title} sizes={GRID_SIZES} eager={eager} />
        {video.spriteVtt && <SpritePreview vtt={video.spriteVtt} />}
        {rank !== undefined && (
          <span className="absolute left-0 top-0 min-w-7 bg-black/80 px-1.5 py-0.5 text-center text-[14px] font-medium leading-5 text-white">
            {rank}
          </span>
        )}
        {video.durationS !== null && (
          <span className="absolute bottom-1 right-1 rounded-sm bg-black/80 px-1 py-[3px] text-[12px] font-medium leading-3 tracking-[0.5px] text-white">
            {formatTime(video.durationS)}
          </span>
        )}
        <ThumbProgress videoId={video.id} />
      </Link>
      <div className="mt-3 flex gap-3 px-3 sm:px-0">
        <Link href={channelHref} className="shrink-0" aria-label={video.channel.name}>
          <Avatar name={video.channel.name} url={video.channel.avatarUrl} size={36} />
        </Link>
        <div className="min-w-0 pr-6">
          <Heading className="line-clamp-2 text-[14px] font-medium leading-5 text-text" title={video.title}>
            <Link href={href}>{video.title}</Link>
          </Heading>
          <p className="mt-1 text-[13px] leading-[18px] text-text-2 sm:mt-1.5">
            <Link href={channelHref} className="hover:text-text sm:block sm:truncate">
              {video.channel.name}
            </Link>
            <span className="sm:hidden"> · </span>
            {viewsLabel(video.views)} · {timeAgo(video.publishedAt, now)}
          </p>
        </div>
      </div>
    </article>
  );
}

/** Grey placeholder in the same shape, for loading rows and the placeholder pages. */
export function VideoCardSkeleton({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`min-w-0 ${className}`} data-card-skeleton>
      <div className="aspect-video bg-skeleton" />
      <div className="mt-3 flex gap-3 px-3 sm:px-0">
        <div className="h-9 w-9 shrink-0 rounded-full bg-skeleton" />
        <div className="flex-1 pr-6">
          <div className="h-4 w-[90%] bg-skeleton" />
          <div className="mt-2 h-4 w-[60%] bg-skeleton" />
        </div>
      </div>
    </div>
  );
}

/**
 * Grid columns like the 2019 home page: 1 on phones up to 5 at 1800 wide.
 * 112.5rem is 1800 px, in rem so Tailwind sorts it after xl (80rem).
 */
export const videoGridClass =
  "grid grid-cols-1 gap-x-4 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[112.5rem]:grid-cols-5";

/**
 * Skeleton cards that fill exactly one row at every width (the extra ones are
 * hidden at narrower widths), for the infinite scroll loading row.
 */
export function SkeletonRow() {
  const hide = ["", "hidden sm:block", "hidden lg:block", "hidden xl:block", "hidden min-[112.5rem]:block"];
  return (
    <>
      {hide.map((c, i) => (
        <VideoCardSkeleton key={i} className={c} />
      ))}
    </>
  );
}
