import Link from "next/link";
import { Thumb } from "@/components/Thumb";
import { ThumbProgress } from "@/components/ThumbProgress";
import { formatTime, shortCount, timeAgo } from "@/lib/watch/format";
import type { UpNextVideo, WatchChannel } from "@/lib/watch/types";

/** Up next shows this many cards, padded with placeholders when there are fewer videos. */
export const UP_NEXT_COUNT = 10;

function Card({ video, channel }: { video: UpNextVideo; channel: WatchChannel }) {
  const href = `/watch?v=${video.id}`;
  return (
    <article className="flex gap-2" data-up-next-card>
      <Link href={href} className="relative block aspect-video w-[168px] shrink-0 overflow-hidden bg-skeleton" tabIndex={-1} aria-hidden>
        {video.thumbnail && <Thumb src={video.thumbnail} alt={video.title} sizes="168px" />}
        {video.durationS !== null && (
          <span className="absolute bottom-1 right-1 rounded-sm bg-black/80 px-1 py-[3px] text-[12px] font-medium leading-3 text-white">
            {formatTime(video.durationS)}
          </span>
        )}
        <ThumbProgress videoId={video.id} />
      </Link>
      <div className="min-w-0 pr-6">
        <h3 className="line-clamp-2 text-[14px] font-medium leading-5 text-text">
          <Link href={href}>{video.title}</Link>
        </h3>
        <p className="mt-1 text-[13px] leading-[18px] text-text-2">
          {video.channelName ?? channel.name}
          <br />
          {shortCount(video.views)} views{video.date ? ` · ${timeAgo(video.date)}` : ""}
        </p>
      </div>
    </article>
  );
}

/** A grey card in the same shape, for the slots the feed fills later. */
function Placeholder({ channel }: { channel: WatchChannel }) {
  return (
    <div className="flex gap-2" data-up-next-placeholder>
      <div className="aspect-video w-[168px] shrink-0 bg-skeleton" />
      <div className="min-w-0 flex-1 pr-6">
        <div className="h-4 w-[90%] bg-skeleton" />
        <div className="mt-1.5 h-4 w-[60%] bg-skeleton" />
        <p className="mt-1.5 truncate text-[13px] leading-[18px] text-text-3">{channel.name}</p>
      </div>
    </div>
  );
}

/** The right column: related videos (or more from this channel), padded with placeholders to 10 cards. */
export function UpNext({ videos, channel }: { videos: UpNextVideo[]; channel: WatchChannel }) {
  const shown = videos.slice(0, UP_NEXT_COUNT);
  const missing = UP_NEXT_COUNT - shown.length;
  return (
    <div className="px-3 pb-6 pt-4 tab:px-0 tab:pt-0">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[16px] font-normal text-text">Up next</h2>
        <span
          title="Autoplay arrives in a later feature."
          className="flex cursor-not-allowed items-center gap-2 text-[13px] font-medium uppercase text-text-2"
        >
          Autoplay
          <span aria-hidden className="relative h-[14px] w-9 rounded-full bg-[var(--progress-track)]">
            <span className="absolute -top-[3px] left-0 h-5 w-5 rounded-full bg-[#bdbdbd] shadow" />
          </span>
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {shown.map((v) => (
          <Card key={v.id} video={v} channel={channel} />
        ))}
        {Array.from({ length: missing }, (_, i) => (
          <Placeholder key={i} channel={channel} />
        ))}
      </div>
    </div>
  );
}
