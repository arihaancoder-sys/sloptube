import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark } from "../icons";

/** A 404 style full page message, like the 2019 "This page isn't available". */
export function ChannelMessage({
  state,
  title,
  children,
}: {
  state: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div data-channel-state={state} className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <LogoMark className="h-16 w-[90px] opacity-40 grayscale" />
      <h1 className="mt-6 text-[20px] font-normal text-text">{title}</h1>
      {children && <div className="mt-2 max-w-[480px] text-[14px] leading-5 text-text-2">{children}</div>}
      <Link href="/" className="btn-blue mt-6">
        Go home
      </Link>
    </div>
  );
}

export function ChannelsOff() {
  return (
    <ChannelMessage state="off" title="Channels aren't on yet">
      Channel pages are switched off right now. Check back soon.
    </ChannelMessage>
  );
}

export function ChannelMissing() {
  return (
    <ChannelMessage state="missing" title="This channel doesn't exist">
      Check the handle in the address, or try searching for something else.
    </ChannelMessage>
  );
}

export function ChannelsNotSetUp() {
  return (
    <ChannelMessage state="not-set-up" title="Channels aren't set up yet">
      The channels table could not be read. Run <code>supabase/migrations/004_channels.sql</code> in the
      Supabase SQL editor, then reload.
    </ChannelMessage>
  );
}

/** Shown above the channel preview when the Supabase settings are missing. */
export function ChannelDbNotice() {
  return (
    <div className="mx-auto max-w-[1284px] px-4 pt-4 sm:px-6">
      <div role="status" className="rounded-sm border border-divider bg-surface px-4 py-3 text-[14px] leading-5 text-text">
        <p className="font-medium">database not connected</p>
        <p className="mt-1 text-text-2">
          This is a preview of how a channel looks. Add the publishable key to <code>.env.local</code> (see{" "}
          <code>.env.example</code>) and restart to see real channels.
        </p>
      </div>
    </div>
  );
}

export function ChannelSkeleton() {
  return (
    <div aria-hidden className="bg-surface">
      <div className="aspect-[4/1] w-full bg-skeleton sm:aspect-[2560/423]" />
      <div className="mx-auto flex max-w-[1284px] items-center gap-6 px-4 py-4 sm:px-6">
        <div className="h-20 w-20 rounded-full bg-skeleton" />
        <div className="flex-1 space-y-2">
          <div className="h-6 w-48 rounded-sm bg-skeleton" />
          <div className="h-4 w-32 rounded-sm bg-skeleton" />
        </div>
      </div>
      <div className="h-12" />
    </div>
  );
}
