import { UploadMessage, UploadsOff } from "@/components/upload/UploadNotices";
import { StatusBadge } from "@/components/upload/StatusBadge";
import { WatchProcessing } from "@/components/processing/WatchProcessing";
import { videoForWatch } from "@/lib/upload/server";

// The /watch page from features 3 and 4, kept for while the watch flag is
// off: it shows where an upload is, and the owner sees "Processing, N%".

const PLAYER_TEXT = {
  uploading: "Uploading",
  uploaded: "Processing",
  processing: "Processing",
  ready: "Playback arrives with the watch page",
  failed: "This upload failed",
} as const;

export async function WatchStub({ v }: { v: string | null }) {
  const state = await videoForWatch(v);
  switch (state.kind) {
    case "off":
      return <UploadsOff />;
    case "no-db":
      return (
        <UploadMessage state="no-db" title="database not connected">
          Add the publishable key to <code>.env.local</code> (see <code>.env.example</code>) and restart to watch
          videos.
        </UploadMessage>
      );
    case "missing":
      return (
        <UploadMessage state="missing" title="Video unavailable">
          This video isn&apos;t available. It may be private, or the link may be wrong.
        </UploadMessage>
      );
    case "found": {
      const { video } = state;
      const showProgress = state.isOwner && state.processingOn && (video.status === "uploaded" || video.status === "processing");
      return (
        <div data-upload-state="found" data-status={video.status} className="mx-auto max-w-[1280px] px-0 sm:px-6 sm:pt-6">
          <div className="grid aspect-video w-full place-items-center bg-black text-center">
            {showProgress ? (
              <WatchProcessing video={video} />
            ) : (
              <div>
                {video.status !== "failed" && video.status !== "ready" && (
                  <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-[#555] border-t-white" />
                )}
                <p className="text-[18px] text-white">{PLAYER_TEXT[video.status]}</p>
                {video.status !== "ready" && video.status !== "failed" && (
                  <p className="mt-1 text-[13px] text-[#aaaaaa]">Check back in a few minutes.</p>
                )}
              </div>
            )}
          </div>
          <div className="px-4 py-4 sm:px-0">
            <h1 className="text-[18px] font-normal leading-[26px] text-text">{video.title}</h1>
            <div className="mt-2">
              <StatusBadge status={video.status} />
            </div>
            {video.description && (
              <p className="mt-4 whitespace-pre-wrap border-t border-divider pt-4 text-[14px] leading-5 text-text">
                {video.description}
              </p>
            )}
          </div>
        </div>
      );
    }
  }
}
