"use client";

import { useEffect, useRef, useState } from "react";
import { CloseIcon, YapinIcon } from "@/components/icons";
import { useFlag } from "@/lib/store/session";
import { useWatch } from "@/lib/store/watch";
import { shareMessage, shareTarget } from "@/lib/yapin/rules";
import { formatTime, startParam } from "@/lib/watch/format";

/** The link to a video, with ?t= when a start time is given. */
export function shareLink(origin: string, videoId: string, startAt: number | null): string {
  const url = `${origin}/watch?v=${videoId}`;
  return startAt && startAt > 0 ? `${url}&t=${startParam(startAt)}` : url;
}

async function copyText(text: string, input: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or no permission: select the field and copy that.
    if (!input) return false;
    input.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
}

/**
 * The 2019 share box: the link, COPY, and "Start at" with the player's time.
 * `path` shares that address instead (Snips share /shorts/<id>), without
 * "Start at". With the yapin flag on (feature 16), a Yapin' button above the
 * link copies a message with the title and link and opens Yapin' to paste it.
 */
export function ShareDialog({ videoId, onClose, path, title = "" }: { videoId: string; onClose: () => void; path?: string; title?: string }) {
  const yapin = useFlag("yapin");
  const now = useWatch((s) => s.currentTime);
  // The time is taken when the box opens, like YouTube, so it does not run away.
  const [at] = useState(now);
  const [startOn, setStartOn] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The box only opens in the browser, after a click.
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const link = path ? origin + path : shareLink(origin, videoId, startOn ? at : null);

  return (
    <>
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-title"
          data-share-dialog
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-[512px] rounded-[2px] bg-surface shadow-[var(--menu-shadow)]"
        >
          <div className="flex items-center justify-between px-6 pt-5">
            <h2 id="share-title" className="text-[16px] font-normal text-text">
              Share
            </h2>
            <button type="button" aria-label="Close" onClick={onClose} className="-mr-2 grid h-10 w-10 place-items-center text-icon">
              <CloseIcon className="h-6 w-6" />
            </button>
          </div>
          {yapin && (
            <div className="flex gap-4 px-6 pt-4" data-share-targets>
              <button
                type="button"
                data-share-yapin
                aria-label="Share to Yapin'"
                onClick={async () => {
                  // Open the tab first, while the click still counts, then copy.
                  const tab = window.open(shareTarget(title, link), "_blank", "noopener,noreferrer");
                  const copied = await copyText(shareMessage(title, link), null);
                  setToast(copied ? "Message copied. Paste it in Yapin'" : tab ? "Paste the link in Yapin'" : "Copy the link and paste it in Yapin'");
                }}
                className="flex w-[72px] flex-col items-center gap-2 rounded-[2px] py-1 text-[12px] text-text hover:bg-hover"
              >
                <YapinIcon className="h-[60px] w-[60px]" />
                Yapin&apos;
              </button>
            </div>
          )}
          <div className="px-6 pb-4 pt-4">
            <div className="flex items-center gap-2 rounded-[2px] border border-divider bg-[var(--input-bg)] py-1 pl-3 pr-1">
              <input
                ref={inputRef}
                readOnly
                value={link}
                aria-label="Link to this video"
                data-share-link
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 bg-transparent text-[15px] text-text outline-none"
              />
              <button
                type="button"
                data-share-copy
                onClick={async () => {
                  if (await copyText(link, inputRef.current)) setToast("Link copied to clipboard");
                }}
                className="h-9 shrink-0 px-4 text-[14px] font-medium uppercase text-link hover:bg-hover"
              >
                Copy
              </button>
            </div>
          </div>
          {!path && (
          <label className="flex cursor-pointer items-center gap-3 border-t border-divider px-6 py-4 text-[14px] text-text">
            <input
              type="checkbox"
              checked={startOn}
              onChange={(e) => setStartOn(e.target.checked)}
              data-share-start
              className="h-4 w-4 accent-[var(--link)]"
            />
            Start at <span className="text-text-2">{formatTime(at)}</span>
          </label>
          )}
        </div>
      </div>
      {toast && (
        <div
          role="status"
          data-share-toast
          className="fixed bottom-6 left-6 z-[60] rounded-[2px] bg-[#323232] px-6 py-3.5 text-[14px] text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </>
  );
}
