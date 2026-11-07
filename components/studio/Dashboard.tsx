import Link from "next/link";
import type { ReactNode } from "react";
import type { Overview } from "@/lib/studio/types";
import { watchHours } from "@/lib/studio/types";
import { formatDate } from "@/lib/watch/format";
import { UploadIcon } from "../icons";

const n = (v: number) => Math.max(0, Math.floor(v)).toLocaleString("en-US");

function Card({ title, children, footer, state }: { title: string; children: ReactNode; footer?: ReactNode; state?: string }) {
  return (
    <section
      data-studio-card={state}
      className="flex flex-col rounded-[2px] bg-surface shadow-[0_0_0_1px_var(--divider)]"
    >
      <h2 className="px-6 pb-2 pt-5 text-[18px] font-normal leading-6 text-text">{title}</h2>
      <div className="flex-1 px-6 pb-4">{children}</div>
      {footer && <div className="border-t border-divider px-6 py-3">{footer}</div>}
    </section>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-divider py-2.5 text-[14px] last:border-0">
      <span className="text-text-2">{label}</span>
      <span className={strong ? "font-medium text-text" : "text-text"}>{value}</span>
    </div>
  );
}

const linkButton = "text-[14px] font-medium uppercase text-[var(--studio-accent)] hover:underline";

// Plain notes for the "What's new" card. Newest first.
const NEWS = [
  { title: "A studio of your own", text: "Your dashboard, your videos and your channel in one place, with the dark nav on the left." },
  { title: "Edit after you upload", text: "Change the title, description, tags, visibility and thumbnail of any video from Content." },
  { title: "Deleted is not gone", text: "Deleted videos wait in the trash for 30 days. Restore them any time before that." },
  { title: "Change many at once", text: "Tick a few videos in Content to set their visibility or move them to the trash together." },
];

/** The 2020 "Channel dashboard": latest video, channel analytics, what's new, and an upload card. */
export function Dashboard({ overview }: { overview: Overview }) {
  const { latest, totals, recent, channel } = overview;
  return (
    <div className="grid items-start gap-6 md:grid-cols-2 xl:grid-cols-3" data-studio-dashboard>
      {latest ? (
        <Card
          title="Latest video performance"
          state="latest"
          footer={
            <div className="flex flex-wrap gap-6">
              <Link href={`/studio/video/${latest.id}/edit`} className={linkButton}>
                Edit video
              </Link>
              <Link href={`/watch?v=${latest.id}`} className={linkButton}>
                View on sloptube
              </Link>
            </div>
          }
        >
          <Link href={`/studio/video/${latest.id}/edit`} className="block">
            {latest.thumbnail ? (
              // A signed R2 link that changes on every load: next/image would only get in the way.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={latest.thumbnail} alt="" className="aspect-video w-full rounded-[2px] bg-black object-cover" />
            ) : (
              <div className="grid aspect-video w-full place-items-center rounded-[2px] bg-skeleton text-[13px] text-text-3">
                {latest.status === "ready" ? "" : "Processing"}
              </div>
            )}
          </Link>
          <p className="mt-3 line-clamp-2 text-[14px] leading-5 text-text" data-latest-title>
            {latest.title}
          </p>
          <p className="mb-2 mt-1 text-[12px] text-text-2">
            {latest.publishedAt ? `Published ${formatDate(latest.publishedAt)}` : `Uploaded ${formatDate(latest.createdAt)}`} ·{" "}
            {latest.visibility[0].toUpperCase() + latest.visibility.slice(1)}
          </p>
          <Stat label="Views" value={n(latest.views)} />
          <Stat label="Likes" value={n(latest.likes)} />
          <Stat label="Comments" value={n(latest.comments)} />
          <Stat label="Watch time (hours)" value={watchHours(latest.watchS)} />
        </Card>
      ) : (
        <Card title="Latest video performance" state="no-video">
          <div className="flex flex-col items-center py-8 text-center">
            <UploadIcon className="h-16 w-16 text-text-3" />
            <p className="mt-4 max-w-[280px] text-[14px] leading-5 text-text-2">
              Want to see metrics on your recent video? Upload and publish a video to get started.
            </p>
            <Link href="/upload" className="btn-blue mt-6">
              Upload videos
            </Link>
          </div>
        </Card>
      )}

      <Card
        title="Channel analytics"
        state="analytics"
        footer={
          <Link href="/studio/content" className={linkButton}>
            Go to channel content
          </Link>
        }
      >
        <p className="text-[14px] text-text-2">Current subscribers</p>
        <p className="mb-4 text-[34px] leading-[44px] text-text" data-subscribers>
          {n(channel?.subscribers ?? 0)}
        </p>
        <h3 className="border-t border-divider pt-4 text-[15px] font-medium text-text">Summary</h3>
        <p className="mb-1 text-[12px] text-text-2">Last {recent.days} days</p>
        <Stat label="Views" value={n(recent.views)} />
        <Stat label="Watch time (hours)" value={watchHours(recent.watchS)} />
        <h3 className="mt-4 border-t border-divider pt-4 text-[15px] font-medium text-text">All time</h3>
        <Stat label="Views" value={n(totals.views)} />
        <Stat label="Videos" value={`${n(totals.videos)} (${n(totals.publicVideos)} public)`} />
        <Stat label="Likes" value={n(totals.likes)} />
        <Stat label="Comments" value={n(totals.comments)} />
        <Stat label="Watch time (hours)" value={watchHours(totals.watchS)} />
      </Card>

      <div className="grid gap-6">
        <Card title="What's new in Studio" state="news">
          <ul>
            {NEWS.map((item) => (
              <li key={item.title} className="border-b border-divider py-3 last:border-0">
                <p className="text-[14px] font-medium leading-5 text-text">{item.title}</p>
                <p className="mt-0.5 text-[13px] leading-[18px] text-text-2">{item.text}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Ideas for you" state="upload">
          <p className="text-[14px] leading-5 text-text-2">
            Regular uploads keep your subscribers coming back. Short and vertical? It becomes a Snip by itself.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/upload" className="btn-blue">
              Upload videos
            </Link>
            {overview.trash > 0 && (
              <Link href="/studio/content/trash" className="btn-text" data-trash-count={overview.trash}>
                Trash ({n(overview.trash)})
              </Link>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
