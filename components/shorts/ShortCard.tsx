import Link from "next/link";
import { Thumb } from "@/components/Thumb";
import { viewsLabel } from "@/lib/feed/format";

// No "use client": the shelf, the channel tab and the client grid all use it.

/** What a 9:16 card needs: a feed card or a short both fit. */
export type ShortCardVideo = { id: string; title: string; thumbnail: string; views: number };

/** A short as a vertical thumbnail with the title and views below, 2020 style. Opens /shorts/<id>. */
export function ShortCard({ video, className = "" }: { video: ShortCardVideo; className?: string }) {
  const href = `/shorts/${video.id}`;
  return (
    <article className={`min-w-0 ${className}`} data-short-card={video.id}>
      <Link href={href} className="relative block aspect-[9/16] overflow-hidden rounded-lg bg-skeleton" tabIndex={-1} aria-hidden>
        <Thumb src={video.thumbnail} alt={video.title} sizes="(min-width: 1280px) 210px, (min-width: 640px) 25vw, 50vw" />
      </Link>
      <h3 className="mt-2 line-clamp-2 pr-2 text-[14px] font-medium leading-5 text-text" title={video.title}>
        <Link href={href}>{video.title}</Link>
      </h3>
      <p className="mt-1 text-[13px] leading-[18px] text-text-2">{viewsLabel(video.views)}</p>
    </article>
  );
}

/** The 9:16 grid on a channel's Snips tab: 2 columns on phones up to 6 on wide screens. */
export const shortsGridClass =
  "grid grid-cols-2 gap-x-3 gap-y-6 px-3 sm:grid-cols-3 sm:gap-x-4 sm:px-0 lg:grid-cols-4 xl:grid-cols-5 min-[112.5rem]:grid-cols-6";

export function ShortCardSkeleton({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`min-w-0 ${className}`} data-card-skeleton>
      <div className="aspect-[9/16] rounded-lg bg-skeleton" />
      <div className="mt-2 h-4 w-[85%] bg-skeleton" />
      <div className="mt-2 h-4 w-[45%] bg-skeleton" />
    </div>
  );
}
