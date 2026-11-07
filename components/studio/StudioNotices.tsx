import Link from "next/link";
import type { ReactNode } from "react";
import { ChannelMessage } from "../channel/ChannelNotices";

/** The studio's page header: a title, a line under it, and buttons on the right. */
export function StudioHeader({ title, hint, children }: { title: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[24px] font-normal leading-8 text-text">{title}</h1>
        {hint && <p className="mt-1 text-[14px] text-text-2">{hint}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/** The room every studio page sits in, on the light grey of the 2020 Studio. */
export function StudioPage({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-[calc(100dvh-56px)] bg-[var(--studio-page)]">
      <div className={`mx-auto px-4 py-6 sm:px-8 ${wide ? "max-w-[1400px]" : "max-w-[1100px]"}`}>{children}</div>
    </div>
  );
}

export function StudioOff() {
  return (
    <div data-studio-state="off">
      <ChannelMessage state="off" title="The creator studio is coming soon">
        A dashboard, your videos with editing and a trash, and channel customization in one place. Until then,{" "}
        <Link href="/upload" className="text-[var(--link)]">
          upload
        </Link>{" "}
        and{" "}
        <Link href="/studio/comments" className="text-[var(--link)]">
          comments
        </Link>{" "}
        work as before.
      </ChannelMessage>
    </div>
  );
}

export function StudioNoDb() {
  return (
    <div data-studio-state="no-db">
      <ChannelMessage state="no-db" title="database not connected">
        Add the publishable key to <code>.env.local</code> (see <code>.env.example</code>) and restart to open the studio.
      </ChannelMessage>
    </div>
  );
}

export function StudioNotSetUp() {
  return (
    <div data-studio-state="not-set-up">
      <ChannelMessage state="not-set-up" title="The studio isn't set up yet">
        Run <code>supabase/migrations/014_studio.sql</code> in the Supabase SQL editor, then reload.
      </ChannelMessage>
    </div>
  );
}

/** Shown above a page that runs on made up rows in `next dev` without a database. */
export function PreviewNotice() {
  return (
    <div role="status" className="mb-6 rounded-sm border border-divider bg-surface px-4 py-3 text-[14px] leading-5 text-text">
      <p className="font-medium">database not connected</p>
      <p className="mt-1 text-text-2">
        This is a preview with made up videos. Add the publishable key to <code>.env.local</code> (see{" "}
        <code>.env.example</code>) and restart to see your own.
      </p>
    </div>
  );
}

export function StudioSkeleton() {
  return (
    <div aria-hidden className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="h-[360px] rounded-[2px] bg-skeleton" />
      ))}
    </div>
  );
}
