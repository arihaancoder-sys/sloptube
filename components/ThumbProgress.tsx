"use client";

import { useEffect } from "react";
import { useProgress } from "@/lib/store/progress";
import { useFlag, useSession } from "@/lib/store/session";

/**
 * The red bar along the bottom of a thumbnail, as far as the signed in
 * viewer got in the video, like 2019. Nothing for signed out viewers, with
 * the engagement flag off, or for videos they have not watched. `fraction`
 * skips the lookup when the page already knows it (the history page).
 */
export function ThumbProgress({ videoId, fraction }: { videoId: string; fraction?: number }) {
  const on = useFlag("engagement");
  const signedIn = useSession((s) => s.user !== null);
  const want = useProgress((s) => s.want);
  const known = useProgress((s) => s.map[videoId]);

  useEffect(() => {
    if (on && signedIn && fraction === undefined) want(videoId);
  }, [on, signedIn, videoId, fraction, want]);

  const value = known ?? fraction ?? 0;
  if (!on || !signedIn || !(value > 0)) return null;
  return (
    <div aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-[rgba(204,204,204,0.6)]" data-thumb-progress={value.toFixed(2)}>
      <div className="h-full bg-[var(--mark)]" style={{ width: `${Math.max(2, Math.round(value * 100))}%` }} />
    </div>
  );
}
