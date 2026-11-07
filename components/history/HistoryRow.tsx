import Link from "next/link";
import { Thumb } from "@/components/Thumb";
import { CloseIcon } from "@/components/icons";
import { ThumbProgress } from "@/components/ThumbProgress";
import { viewsLabel } from "@/lib/feed/format";
import type { HistoryCard } from "@/lib/engagement/types";
import { formatTime } from "@/lib/watch/format";

// No "use client": the list renders these, and they hold no state.

/**
 * A video on the history page, the 2019 list row: the thumbnail on the left
 * with the duration and the red bar for how far you got, then the title,
 * "channel · 1.2K views", two lines of the description, and the X that
 * removes it from your history. On phones it is a compact row with a
 * smaller thumbnail.
 */
export function HistoryRow({ video, onRemove }: { video: HistoryCard; onRemove?: (id: string) => void }) {
  const href = `/watch?v=${video.id}`;
  const channelHref = `/@${video.channel.handle}`;
  return (
    <article className="group/row flex gap-3 px-3 search:gap-4 search:px-0" data-history-row={video.id}>
      <Link
        href={href}
        className="relative block aspect-video w-[160px] shrink-0 overflow-hidden bg-skeleton search:w-[246px]"
        tabIndex={-1}
        aria-hidden
      >
        <Thumb src={video.thumbnail} alt={video.title} sizes="(min-width: 656px) 246px, 160px" />
        {video.durationS !== null && (
          <span className="absolute bottom-1.5 right-1 rounded-sm bg-black/80 px-1 py-[3px] text-[12px] font-medium leading-3 tracking-[0.5px] text-white">
            {formatTime(video.durationS)}
          </span>
        )}
        <ThumbProgress videoId={video.id} fraction={video.progress} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <h3
            className="line-clamp-2 min-w-0 flex-1 text-[14px] font-medium leading-5 text-text search:text-[18px] search:font-normal search:leading-[26px]"
            title={video.title}
          >
            <Link href={href}>{video.title}</Link>
          </h3>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(video.id)}
              title="Remove from Watch history"
              aria-label={`Remove ${video.title} from Watch history`}
              data-history-remove={video.id}
              className="-mr-2 -mt-2 grid h-10 w-10 shrink-0 place-items-center rounded-full text-icon hover:bg-hover search:opacity-0 search:group-hover/row:opacity-100 search:focus:opacity-100"
            >
              <CloseIcon className="h-6 w-6" />
            </button>
          )}
        </div>
        <p className="mt-1 text-[12px] leading-[18px] text-text-2 search:text-[13px]">
          <Link href={channelHref} className="hover:text-text">
            {video.channel.name}
          </Link>{" "}
          · {viewsLabel(video.views)}
        </p>
        {video.description && (
          <p className="mt-2 hidden text-[13px] leading-[18px] text-text-2 search:line-clamp-2">{video.description}</p>
        )}
      </div>
    </article>
  );
}

/** A grey placeholder in the same shape, while the next page loads. */
export function HistoryRowSkeleton() {
  return (
    <div aria-hidden data-card-skeleton className="flex gap-3 px-3 search:gap-4 search:px-0">
      <div className="aspect-video w-[160px] shrink-0 bg-skeleton search:w-[246px]" />
      <div className="flex-1 pr-6">
        <div className="h-5 w-[80%] bg-skeleton" />
        <div className="mt-2 h-4 w-[40%] bg-skeleton" />
        <div className="mt-4 hidden h-4 w-[90%] bg-skeleton search:block" />
      </div>
    </div>
  );
}
