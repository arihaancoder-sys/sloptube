"use client";

import { useEffect, type ReactNode } from "react";
import { useWatch } from "@/lib/store/watch";

/**
 * The 2019 watch page grid (styles in app/globals.css, `.watch-grid`):
 *   from 1016 px  player and info on the left (up to 1280 wide), Up next on
 *                 the right (402 wide). Theater mode puts the player across the
 *                 whole width above both columns.
 *   below that    everything stacked, the player on top, edge to edge.
 * The player stays the same element in both modes, so switching does not
 * restart the video.
 */
export function WatchLayout({
  player,
  info,
  side,
  comments = null,
}: {
  player: ReactNode;
  info: ReactNode;
  side: ReactNode;
  /** Under the description on wide screens; under Up next when stacked, like 2019. */
  comments?: ReactNode;
}) {
  const theater = useWatch((s) => s.theater);
  const syncTheater = useWatch((s) => s.syncTheater);
  useEffect(() => syncTheater(), [syncTheater]);

  return (
    <div className="watch-grid" data-theater={theater ? "true" : "false"} data-watch-layout>
      <div className="watch-player">
        <div className="watch-player-box">{player}</div>
      </div>
      <div className="watch-info">{info}</div>
      <aside className="watch-side" aria-label="Up next">
        {side}
      </aside>
      {comments && <div className="watch-comments">{comments}</div>}
    </div>
  );
}
