import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FormSkeleton } from "@/components/auth/AuthCard";
import { ChannelsNotSetUp, ChannelsOff } from "@/components/channel/ChannelNotices";
import { ChannelEditor } from "@/components/studio/ChannelEditor";
import { myChannel } from "@/lib/channels/server";
import { previewChannel } from "@/lib/channels/types";

export const metadata = { title: "Channel customization | sloptube" };

async function StudioGate() {
  const state = await myChannel();
  switch (state.kind) {
    case "off":
      return <ChannelsOff />;
    case "not-set-up":
      return <ChannelsNotSetUp />;
    case "signed-out":
      redirect("/login?next=/studio/channel");
    case "no-db":
      return (
        <div data-channel-state="no-db">
          <div role="status" className="mb-6 rounded-sm border border-divider bg-surface px-4 py-3 text-[14px] leading-5 text-text">
            <p className="font-medium">database not connected</p>
            <p className="mt-1 text-text-2">
              This is a preview of the editor. Add the publishable key to <code>.env.local</code> (see{" "}
              <code>.env.example</code>) and restart to edit a real channel.
            </p>
          </div>
          <ChannelEditor channel={previewChannel("your_channel")} disabled />
        </div>
      );
    case "ready":
      return (
        <div data-channel-state="ready">
          <ChannelEditor channel={state.channel} />
        </div>
      );
  }
}

export default function StudioChannelPage() {
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
      <h1 className="text-[24px] font-normal leading-8 text-text">Channel customization</h1>
      <p className="mb-6 mt-1 text-[14px] text-text-2">Change how your channel looks to viewers.</p>
      <Suspense fallback={<FormSkeleton />}>
        <StudioGate />
      </Suspense>
    </div>
  );
}
