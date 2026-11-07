"use client";

import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef } from "react";
import { ThumbDownIcon, ThumbUpIcon } from "@/components/icons";
import { initialReaction, likeRatio, nextReaction, reduceReaction, viewReaction } from "@/lib/engagement/reaction";
import { engagementErrorMessage, type Reaction } from "@/lib/engagement/rules";
import type { ReactionResult, WatchEngagement } from "@/lib/engagement/types";
import { useSubscriptions } from "@/lib/store/subscriptions";
import { shortCount } from "@/lib/watch/format";

const button =
  "flex h-9 items-center gap-1.5 px-1.5 text-[13px] font-medium uppercase tracking-[0.007px] sm:px-2";

function Thumb({
  kind,
  count,
  on,
  disabled,
  title,
  onClick,
}: {
  kind: Reaction;
  count: string;
  on: boolean;
  disabled?: boolean;
  title: string;
  onClick?: () => void;
}) {
  const Icon = kind === "like" ? ThumbUpIcon : ThumbDownIcon;
  const label = kind === "like" ? "I like this" : "I dislike this";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={disabled ? undefined : on}
      data-reaction={kind}
      data-on={on ? "1" : undefined}
      className={`${button} ${on ? "text-link" : "text-text-2"} ${disabled ? "cursor-not-allowed opacity-60" : "hover:text-text"}`}
    >
      <Icon className={`h-6 w-6 ${on ? "text-link" : "text-icon"}`} />
      {/* The name is the label and the count, so it includes what the button shows. */}
      <span className="sr-only">{label}</span>
      <span data-reaction-count={kind}>{count}</span>
    </button>
  );
}

/** The disabled placeholders, while the flag is off or there is no database. */
function Placeholder() {
  const title = "Likes aren't on yet.";
  return (
    <>
      <Thumb kind="like" count="0" on={false} disabled title={title} />
      <Thumb kind="dislike" count="0" on={false} disabled title={title} />
    </>
  );
}

/**
 * The 2019 thumbs with counts, under the title. Clicks show at once and go
 * to the server one at a time (lib/engagement/reaction.ts). Signed out, a
 * click goes to sign in and comes back. Only the owner gets the dislike
 * count, and with it the like bar under the thumbs (likes against
 * dislikes); everybody else sees the dislike thumb without a number.
 */
export function LikeButtons({ videoId, engagement }: { videoId: string; engagement: WatchEngagement | null }) {
  const router = useRouter();
  // engagement is only there when the server found the flag on for this viewer.
  const signedIn = engagement?.signedIn === true;
  const showToast = useSubscriptions((s) => s.showToast);
  const [state, dispatch] = useReducer(
    reduceReaction,
    engagement ?? { likes: 0, dislikes: null, reaction: null },
    (e) => initialReaction({ reaction: e.reaction, likes: e.likes, dislikes: e.dislikes }),
  );
  const busy = useRef(false);

  // Send what the buttons still need, one request at a time.
  useEffect(() => {
    const kind = nextReaction(state);
    if (kind === undefined || busy.current) return;
    busy.current = true;
    dispatch({ type: "sent" });
    void (async () => {
      try {
        const res = await fetch("/api/reactions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ videoId, kind }),
        });
        const body = (await res.json().catch(() => ({}))) as Partial<ReactionResult> & { error?: string };
        if (!res.ok || typeof body.likes !== "number") throw new Error(body.error ?? "failed");
        dispatch({
          type: "settled",
          server: { reaction: body.reaction ?? null, likes: body.likes, dislikes: body.dislikes ?? null },
        });
      } catch (err) {
        const code = err instanceof Error ? err.message : "failed";
        dispatch({ type: "failed", error: code });
        showToast(engagementErrorMessage(code));
      } finally {
        busy.current = false;
      }
    })();
  }, [state, videoId, showToast]);

  if (!engagement) return <Placeholder />;

  const view = viewReaction(state);
  const ratio = likeRatio(view);
  const click = (kind: Reaction) => {
    if (!signedIn) {
      const here = window.location.pathname + window.location.search;
      router.push(`/login?next=${encodeURIComponent(here)}`);
      return;
    }
    dispatch({ type: "click", kind });
  };

  return (
    <div className="relative flex items-center" data-reactions={view.reaction ?? "none"}>
      <Thumb
        kind="like"
        count={shortCount(view.likes)}
        on={view.reaction === "like"}
        title={view.reaction === "like" ? "Unlike" : "I like this"}
        onClick={() => click("like")}
      />
      <Thumb
        kind="dislike"
        count={view.dislikes === null ? "" : shortCount(view.dislikes)}
        on={view.reaction === "dislike"}
        title="I dislike this"
        onClick={() => click("dislike")}
      />
      {ratio !== null && (
        <div
          aria-hidden
          data-like-bar={ratio.toFixed(2)}
          className="absolute -bottom-[9px] left-1.5 right-1.5 h-0.5 bg-[var(--progress-track)] sm:left-2 sm:right-2"
        >
          <div
            className={`h-full ${view.reaction ? "bg-link" : "bg-text-3"}`}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
