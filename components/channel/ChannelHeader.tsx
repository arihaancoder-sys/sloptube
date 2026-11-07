import Image from "next/image";
import Link from "next/link";
import type { Channel } from "@/lib/channels/types";
import { formatJoined, formatSubscribers } from "@/lib/channels/validation";
import { Avatar } from "../Avatar";
import { ChannelReport } from "../moderation/ChannelReport";
import { SubscribeButton } from "../subscriptions/SubscribeButton";
import { SubscriberCount } from "../subscriptions/SubscriberCount";

export type ChannelTab = "home" | "videos" | "shorts" | "about";

const allTabs: { key: ChannelTab; label: string; path: string }[] = [
  { key: "home", label: "Home", path: "" },
  { key: "videos", label: "Videos", path: "/videos" },
  { key: "shorts", label: "Snips", path: "/shorts" },
  { key: "about", label: "About", path: "/about" },
];

/**
 * The banner. 2560 x 423 on wide screens. On phones the box is a little
 * taller and the whole banner is letterboxed inside it, so nothing is cut off.
 */
export function ChannelBanner({ url, placeholder }: { url: string | null; placeholder?: string }) {
  if (!url && !placeholder) return null;
  return (
    <div className="relative aspect-[4/1] w-full overflow-hidden bg-[#0f0f0f] sm:aspect-[2560/423]">
      {url ? (
        <Image src={url} alt="" fill sizes="100vw" unoptimized preload className="object-contain sm:object-cover" />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-skeleton text-[14px] text-text-2">
          {placeholder}
        </div>
      )}
    </div>
  );
}

/**
 * The 2019 channel header: banner, avatar, name, handle and subscribers,
 * the action button, then the tab bar. Used by the public page and, with
 * `preview`, by the live preview in the studio.
 */
export function ChannelHeader({
  channel,
  tab,
  isOwner,
  preview,
  bannerPlaceholder,
  onTab,
  shorts = false,
}: {
  channel: Channel;
  tab: ChannelTab;
  isOwner?: boolean;
  /** Studio preview: links and buttons do nothing. */
  preview?: boolean;
  bannerPlaceholder?: string;
  /** Studio preview: switch the previewed tab instead of following a link. */
  onTab?: (tab: ChannelTab) => void;
  /** The Snips tab, only with the shorts flag on (feature 11). */
  shorts?: boolean;
}) {
  const base = `/@${channel.handle}`;
  const tabs = allTabs.filter((t) => t.key !== "shorts" || shorts);

  return (
    <div className="bg-surface">
      <ChannelBanner url={channel.bannerUrl} placeholder={bannerPlaceholder} />
      <div className="mx-auto max-w-[1284px] px-4 sm:px-6">
        <div className="flex flex-col items-center gap-3 py-4 text-center sm:flex-row sm:gap-6 sm:py-4 sm:text-left">
          <span className="sm:hidden">
            <Avatar name={channel.name} url={channel.avatarUrl} size={72} />
          </span>
          <span className="hidden sm:block">
            <Avatar name={channel.name} url={channel.avatarUrl} size={80} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[20px] font-normal leading-7 text-text sm:text-[24px] sm:leading-[30px]">
              {channel.name}
            </h1>
            <p className="mt-0.5 truncate text-[14px] leading-5 text-text-2">
              <span>@{channel.handle}</span>
              <span className="mx-1">&middot;</span>
              {preview ? (
                <span>{formatSubscribers(channel.subscriberCount)}</span>
              ) : (
                <SubscriberCount channelId={channel.id} count={channel.subscriberCount} />
              )}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {isOwner ? (
              preview ? (
                <span className="btn-blue">Customize channel</span>
              ) : (
                <Link href="/studio/channel" className="btn-blue">
                  Customize channel
                </Link>
              )
            ) : preview ? (
              <span className="inline-flex h-9 items-center rounded-[2px] bg-red px-4 text-[14px] font-medium uppercase tracking-[0.007px] text-white">
                Subscribe
              </span>
            ) : (
              <>
                <SubscribeButton channelId={channel.id} channelName={channel.name} count={channel.subscriberCount} />
                <ChannelReport channelId={channel.id} />
              </>
            )}
          </div>
        </div>
        <nav aria-label="Channel" className="-mx-4 flex overflow-x-auto sm:mx-0">
          {tabs.map((t) => {
            const active = t.key === tab;
            const className = `flex h-12 shrink-0 items-center border-b-2 px-6 text-[14px] font-medium uppercase tracking-[0.007px] sm:px-8 ${
              active ? "border-[var(--text-2)] text-text" : "border-transparent text-text-2 hover:text-text"
            }`;
            return preview ? (
              <button
                key={t.key}
                type="button"
                aria-pressed={active}
                onClick={() => onTab?.(t.key)}
                className={className}
              >
                {t.label}
              </button>
            ) : (
              <Link key={t.key} href={base + t.path} aria-current={active ? "page" : undefined} className={className}>
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

export function NoVideos({ isOwner }: { isOwner?: boolean }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <svg viewBox="0 0 24 24" aria-hidden className="h-24 w-24 text-text-3" fill="currentColor">
        <path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4zm2 14H4V10h16v8z" />
      </svg>
      <p className="mt-4 text-[16px] leading-[22px] text-text">This channel has no videos yet</p>
      {isOwner && <p className="mt-1 text-[14px] text-text-2">Videos you upload show up here.</p>}
    </div>
  );
}

export function ChannelAbout({ channel }: { channel: Channel }) {
  const joined = formatJoined(channel.createdAt);
  return (
    <div className="mx-auto flex max-w-[1284px] flex-col gap-8 px-4 py-6 sm:px-6 md:flex-row md:gap-12">
      <div className="min-w-0 flex-1">
        <section className="border-b border-divider pb-6">
          <h2 className="text-[16px] font-normal leading-[22px] text-text">Description</h2>
          <p className="mt-4 whitespace-pre-wrap break-words text-[14px] leading-5 text-text">
            {channel.description || <span className="text-text-2">This channel has no description yet.</span>}
          </p>
        </section>
        {channel.links.length > 0 && (
          <section className="pt-6">
            <h2 className="text-[16px] font-normal leading-[22px] text-text">Links</h2>
            <ul className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
              {channel.links.map((link, i) => (
                <li key={i}>
                  <a href={link.url} rel="nofollow noopener noreferrer" target="_blank" className="link text-[14px]">
                    {link.title}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <aside className="md:w-[310px]">
        <h2 className="border-b border-divider pb-3 text-[16px] font-normal leading-[22px] text-text">Stats</h2>
        <p className="border-b border-divider py-3 text-[14px] text-text">Joined {joined}</p>
        <p className="border-b border-divider py-3 text-[14px] text-text">
          {channel.videoCount === 1 ? "1 video" : `${channel.videoCount} videos`}
        </p>
      </aside>
    </div>
  );
}
