"use client";

import Link from "next/link";
import { ProcessingProgress } from "@/components/processing/ProcessingProgress";
import { useLiveStatuses } from "@/lib/processing/useLiveStatus";
import { formatBytes } from "@/lib/upload/rules";
import type { StudioVideo } from "@/lib/upload/server";
import { StatusBadge } from "./StatusBadge";

const VISIBILITY_LABEL = { private: "Private", unlisted: "Unlisted", public: "Public" } as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function Thumbnail({ video }: { video: StudioVideo }) {
  if (video.status === "ready" && video.thumbnailUrl) {
    return (
      // A signed R2 link that changes on every load: next/image would only get in the way.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={video.thumbnailUrl}
        alt=""
        data-thumbnail
        className="aspect-video w-[120px] shrink-0 rounded-[2px] bg-black object-cover"
      />
    );
  }
  const text = video.status === "processing" || video.status === "uploaded" ? "Processing" : "No thumbnail";
  return (
    <div className="grid aspect-video w-[120px] shrink-0 place-items-center rounded-[2px] bg-[var(--skeleton)] text-[11px] text-text-3">
      {video.status === "ready" ? "" : text}
    </div>
  );
}

/**
 * The 2019 Studio "Channel videos" list, read only for now. With processing
 * on it asks for news every 5 seconds while a video is being processed.
 */
export function VideoTable({ videos: initial, poll = false }: { videos: StudioVideo[]; poll?: boolean }) {
  const videos = useLiveStatuses(initial, poll);
  return (
    <div className="overflow-hidden bg-surface sm:rounded-[2px] sm:shadow-[0_0_0_1px_var(--divider)]">
      <div className="hidden grid-cols-[1fr_110px_120px_110px_90px] gap-4 border-b border-divider px-4 py-3 text-[12px] font-medium uppercase text-text-2 md:grid">
        <span>Video</span>
        <span>Visibility</span>
        <span>Status</span>
        <span>Date</span>
        <span className="text-right">Size</span>
      </div>
      {videos.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <p className="text-[16px] leading-6 text-text">No videos yet</p>
          <p className="mt-1 text-[14px] text-text-2">Videos you upload show up here.</p>
        </div>
      ) : (
        <ul>
          {videos.map((v) => (
            <li
              key={v.id}
              className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 border-b border-divider px-4 py-3 last:border-0 md:grid-cols-[1fr_110px_120px_110px_90px] md:items-center"
            >
              <div className="col-span-2 flex min-w-0 gap-4 md:col-span-1">
                <Thumbnail video={v} />
                <div className="min-w-0">
                  <Link href={`/watch?v=${v.id}`} className="line-clamp-2 text-[14px] leading-5 text-text hover:underline">
                    {v.title}
                  </Link>
                  <p className="mt-1 line-clamp-2 text-[12px] leading-4 text-text-2">
                    {v.status === "failed" && v.error ? `Failed: ${v.error}` : v.description || "Add description"}
                  </p>
                </div>
              </div>
              <span className="text-[13px] text-text-2 md:text-text">{VISIBILITY_LABEL[v.visibility]}</span>
              <span className="justify-self-end md:justify-self-start" data-video-status={v.status}>
                <StatusBadge status={v.status} />
                <ProcessingProgress video={v} />
              </span>
              <span className="text-[13px] text-text-2">{formatDate(v.createdAt)}</span>
              <span className="justify-self-end text-[13px] text-text-2">
                {v.sourceBytes ? formatBytes(v.sourceBytes) : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function VideoTableSkeleton() {
  return (
    <div aria-hidden className="space-y-3">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="h-[84px] rounded-[2px] bg-skeleton" />
      ))}
    </div>
  );
}
