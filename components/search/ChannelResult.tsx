import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { SubscribeButton } from "@/components/subscriptions/SubscribeButton";
import { SubscriberCount } from "@/components/subscriptions/SubscriberCount";
import type { SearchChannel } from "@/lib/search/types";
import { Highlighted } from "./VideoResult";

function videosLabel(n: number) {
  return n === 1 ? "1 video" : `${n} videos`;
}

/**
 * A channel in the search results, 2019 style: the round avatar centered in
 * the thumbnail column, the name, "@handle • 1.2K subscribers • 12 videos",
 * the description, and SUBSCRIBE on the right.
 */
export function ChannelResult({ channel, words }: { channel: SearchChannel; words: string[] }) {
  const href = `/@${channel.handle}`;
  return (
    <article className="flex items-center gap-4 px-3 search:px-0" data-search-channel={channel.handle}>
      <Link
        href={href}
        className="grid w-[64px] shrink-0 place-items-center search:w-[246px] tab:w-[360px]"
        aria-label={channel.name}
      >
        <span className="search:hidden">
          <Avatar name={channel.name} url={channel.avatarUrl} size={64} />
        </span>
        <span className="hidden search:block">
          <Avatar name={channel.name} url={channel.avatarUrl} size={136} />
        </span>
      </Link>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[16px] leading-[22px] text-text search:text-[18px] search:leading-[26px]">
          <Link href={href}>{channel.name}</Link>
        </h3>
        <p className="text-[13px] leading-[18px] text-text-2">
          <span className="hidden search:inline">@{channel.handle} • </span>
          <SubscriberCount channelId={channel.id} count={channel.subscriberCount} /> • {videosLabel(channel.videoCount)}
        </p>
        {channel.description && (
          <div className="mt-1 hidden search:block">
            <p className="line-clamp-2 text-[13px] leading-[18px] text-text-2">
              <Highlighted text={channel.description} words={words} />
            </p>
          </div>
        )}
        <div className="mt-2 search:hidden">
          <SubscribeButton channelId={channel.id} channelName={channel.name} count={channel.subscriberCount} />
        </div>
      </div>
      <div className="hidden shrink-0 search:block">
        <SubscribeButton channelId={channel.id} channelName={channel.name} count={channel.subscriberCount} />
      </div>
    </article>
  );
}
