import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ChannelMessage } from "@/components/channel/ChannelNotices";
import { StudioComments } from "@/components/comments/StudioComments";
import { studioComments } from "@/lib/comments/server";

export const metadata = { title: "Channel comments | sloptube" };

async function CommentsGate() {
  const state = await studioComments();
  switch (state.kind) {
    case "off":
      return (
        <div data-studio-comments-state="off">
          <ChannelMessage state="off" title="Comments aren't on yet">
            Comments are switched off right now. Check back soon.
          </ChannelMessage>
        </div>
      );
    case "no-db":
      return (
        <div data-studio-comments-state="no-db">
          <ChannelMessage state="no-db" title="database not connected">
            Add the publishable key to <code>.env.local</code> (see <code>.env.example</code>) and restart to see the
            comments on your videos.
          </ChannelMessage>
        </div>
      );
    case "signed-out":
      redirect("/login?next=/studio/comments");
    case "not-set-up":
      return (
        <div data-studio-comments-state="not-set-up">
          <ChannelMessage state="not-set-up" title="Comments aren't set up yet">
            Run <code>supabase/migrations/012_comments.sql</code> in the Supabase SQL editor, then reload.
          </ChannelMessage>
        </div>
      );
    case "ready":
      return (
        <div data-studio-comments-state="ready">
          <StudioComments comments={state.comments} channelDefault={state.channelDefault} now={state.now} />
        </div>
      );
  }
}

export default function StudioCommentsPage() {
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
      <div className="mb-6">
        <h1 className="text-[24px] font-normal leading-8 text-text">Channel comments</h1>
        <p className="mt-1 text-[14px] text-text-2">The latest 50 comments on your videos. More tools come with the creator studio.</p>
      </div>
      <Suspense fallback={<div className="h-40 rounded-sm bg-skeleton" aria-hidden />}>
        <CommentsGate />
      </Suspense>
    </div>
  );
}
