import Link from "next/link";
import { Thumb } from "@/components/Thumb";
import { Avatar } from "@/components/Avatar";
import { SpritePreview } from "@/components/feed/SpritePreview";
import { ThumbProgress } from "@/components/ThumbProgress";
import { VideoCard } from "@/components/VideoCard";
import { viewsLabel } from "@/lib/feed/format";
import { highlight, snippet } from "@/lib/search/snippet";
import type { SearchVideo } from "@/lib/search/types";
import { formatTime, timeAgo } from "@/lib/watch/format";

// No "use client": the server page and the client list both render these.

/** Text with the matched words in bold. */
export function Highlighted({ text, words }: { text: string; words: string[] }) {
  return (
    <>
      {highlight(text, words).map((p, i) =>
        p.bold ? (
          <b key={i} className="font-medium text-text" data-search-hit>
            {p.text}
          </b>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/**
 * A video in the search results, 2020 style: the 360 px thumbnail on the
 * left, then the title, "1.2K views • 3 days ago", the channel with its small
 * avatar, and two lines of the description with the matched words in bold.
 * Below 656 px it is the home feed card instead.
 */
export function VideoResult({ video, now, words }: { video: SearchVideo; now: number; words: string[] }) {
  const href = `/watch?v=${video.id}`;
  const channelHref = `/@${video.channel.handle}`;
  const text = snippet(video.description, words);
  return (
    <div data-search-video={video.id}>
      <div className="search:hidden">
        <VideoCard video={video} now={now} />
      </div>
      <article className="hidden gap-4 search:flex">
        <Link
          href={href}
          className="relative block aspect-video w-[246px] shrink-0 overflow-hidden bg-skeleton tab:w-[360px]"
          tabIndex={-1}
          aria-hidden
        >
          <Thumb src={video.thumbnail} alt={video.title} sizes="(min-width: 792px) 360px, 246px" />
          {video.spriteVtt && <SpritePreview vtt={video.spriteVtt} />}
          {video.durationS !== null && (
            <span className="absolute bottom-1 right-1 rounded-sm bg-black/80 px-1 py-[3px] text-[12px] font-medium leading-3 tracking-[0.5px] text-white">
              {formatTime(video.durationS)}
            </span>
          )}
          <ThumbProgress videoId={video.id} />
        </Link>
        <div className="min-w-0 flex-1 pr-6">
          <h3 className="line-clamp-2 text-[18px] font-normal leading-[26px] text-text" title={video.title}>
            <Link href={href}>{video.title}</Link>
          </h3>
          <p className="text-[13px] leading-[18px] text-text-2">
            {viewsLabel(video.views)} • {timeAgo(video.publishedAt, now)}
          </p>
          <Link href={channelHref} className="my-3 flex items-center gap-2 text-[13px] leading-[18px] text-text-2 hover:text-text">
            <Avatar name={video.channel.name} url={video.channel.avatarUrl} size={24} />
            <span className="truncate">{video.channel.name}</span>
          </Link>
          {text && (
            <p className="line-clamp-2 text-[13px] leading-[18px] text-text-2" data-search-snippet>
              <Highlighted text={text} words={words} />
            </p>
          )}
        </div>
      </article>
    </div>
  );
}

/** A grey placeholder in the same shape, while the next page loads. */
export function VideoResultSkeleton() {
  return (
    <div aria-hidden data-card-skeleton>
      <div className="search:hidden">
        <div className="aspect-video bg-skeleton" />
        <div className="mt-3 flex gap-3 px-3">
          <div className="h-9 w-9 shrink-0 rounded-full bg-skeleton" />
          <div className="flex-1 pr-6">
            <div className="h-4 w-[90%] bg-skeleton" />
            <div className="mt-2 h-4 w-[60%] bg-skeleton" />
          </div>
        </div>
      </div>
      <div className="hidden gap-4 search:flex">
        <div className="aspect-video w-[246px] shrink-0 bg-skeleton tab:w-[360px]" />
        <div className="flex-1 pr-6">
          <div className="h-5 w-[80%] bg-skeleton" />
          <div className="mt-2 h-4 w-[40%] bg-skeleton" />
          <div className="mt-4 h-4 w-[30%] bg-skeleton" />
          <div className="mt-4 h-4 w-[90%] bg-skeleton" />
        </div>
      </div>
    </div>
  );
}
