import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { UploadMessage, UploadsOff } from "@/components/upload/UploadNotices";
import { VideoTable, VideoTableSkeleton } from "@/components/upload/VideoTable";
import { studioOn } from "@/lib/studio/server";
import { myVideos } from "@/lib/upload/server";

export const metadata = { title: "Channel videos | sloptube" };

async function VideosGate() {
  // With the creator studio on, Content (feature 12) takes over this list.
  if (await studioOn()) redirect("/studio/content");
  const state = await myVideos();
  switch (state.kind) {
    case "off":
      return <UploadsOff />;
    case "signed-out":
      redirect("/login?next=/studio/videos");
    case "not-set-up":
      return (
        <UploadMessage state="not-set-up" title="Videos aren't set up yet">
          The videos table could not be read. Run <code>supabase/migrations/005_videos.sql</code> in the Supabase SQL
          editor, then reload.
        </UploadMessage>
      );
    case "no-db":
      return (
        <div data-upload-state="no-db">
          <div role="status" className="mb-6 rounded-sm border border-divider bg-surface px-4 py-3 text-[14px] leading-5 text-text">
            <p className="font-medium">database not connected</p>
            <p className="mt-1 text-text-2">
              Add the publishable key to <code>.env.local</code> (see <code>.env.example</code>) and restart to see
              your uploads here.
            </p>
          </div>
          <VideoTable videos={[]} />
        </div>
      );
    case "preview":
      return (
        <div data-upload-state="preview">
          <div role="status" className="mb-6 rounded-sm border border-divider bg-surface px-4 py-3 text-[14px] leading-5 text-text">
            <p className="font-medium">database not connected</p>
            <p className="mt-1 text-text-2">
              This is a preview with sample videos. Add the publishable key to <code>.env.local</code> (see{" "}
              <code>.env.example</code>) and restart to see your uploads.
            </p>
          </div>
          <VideoTable videos={state.videos} />
        </div>
      );
    case "ready":
      return (
        <div data-upload-state="ready">
          <VideoTable videos={state.videos} poll={state.processingOn} />
        </div>
      );
  }
}

export default function StudioVideosPage() {
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-normal leading-8 text-text">Channel videos</h1>
          <p className="mt-1 text-[14px] text-text-2">Your uploads and where each one is. Editing comes later.</p>
        </div>
        <Link href="/upload" className="btn-blue">
          Upload video
        </Link>
      </div>
      <Suspense fallback={<VideoTableSkeleton />}>
        <VideosGate />
      </Suspense>
    </div>
  );
}
