"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useLiveStatuses } from "@/lib/processing/useLiveStatus";
import type { LiveStatus } from "@/lib/processing/status";

/**
 * The player area of the /watch stub for the owner while the video is being
 * processed: "Processing, N%", asked for again every 5 seconds. When the
 * video is ready (or failed) the page reloads its data.
 */
export function WatchProcessing({ video }: { video: Pick<LiveStatus, "id" | "status" | "progress" | "job" | "thumbnailUrl" | "error"> }) {
  const [live] = useLiveStatuses([video], true);
  const router = useRouter();
  const finished = live.status === "ready" || live.status === "failed";

  useEffect(() => {
    if (finished && video.status !== live.status) router.refresh();
  }, [finished, live.status, video.status, router]);

  const pct = live.job?.status === "running" ? (live.progress ?? 0) : 0;
  const waiting = live.job?.status !== "running";
  return (
    <div data-watch-processing={pct}>
      <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-[#555] border-t-white" />
      <p className="text-[18px] text-white">{finished ? "Almost there" : `Processing, ${pct}%`}</p>
      <p className="mt-1 text-[13px] text-[#aaaaaa]">
        {waiting ? "Waiting for the encoder. This page updates by itself." : "Only you see this. This page updates by itself."}
      </p>
    </div>
  );
}
