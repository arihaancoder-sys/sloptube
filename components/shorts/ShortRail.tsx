"use client";

import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, type ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import { CommentIcon, ShareIcon, ThumbDownIcon, ThumbUpIcon } from "@/components/icons";
import { initialReaction, nextReaction, reduceReaction, viewReaction } from "@/lib/engagement/reaction";
import { engagementErrorMessage, type Reaction } from "@/lib/engagement/rules";
import type { ReactionResult } from "@/lib/engagement/types";
import type { Short } from "@/lib/shorts/types";
import { useSession } from "@/lib/store/session";
import { useSubscriptions } from "@/lib/store/subscriptions";
import { shortCount } from "@/lib/watch/format";

function RailButton({
  label,
  text,
  on = false,
  onClick,
  disabled,
  data,
  children,
}: {
  label: string;
  text: string;
  on?: boolean;
  onClick: () => void;
  disabled?: boolean;
  data: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={on}
      title={label}
      {...data}
      className="flex flex-col items-center gap-1 text-white disabled:opacity-50"
    >
      <span className={`grid h-12 w-12 place-items-center rounded-full ${on ? "bg-white/25" : "bg-black/30 hover:bg-black/50"}`}>{children}</span>
      <span className="text-[13px] font-medium leading-4 [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">{text}</span>
    </button>
  );
}

/**
 * The right rail on a short, the first 2020 Snips look: white icons over
 * the video for like (with the count), dislike, comments (with the count)
 * and share, and the channel's picture at the bottom, linking to the
 * channel. Likes work like the watch page (feature 9): they show at once,
 * one request runs at a time, and signed out a click goes to sign in. With
 * the engagement flag off the thumbs are greyed out.
 */
export function ShortRail({
  short,
  likesOn,
  commentsOpen,
  onComments,
  onShare,
}: {
  short: Short;
  likesOn: boolean;
  commentsOpen: boolean;
  onComments: () => void;
  onShare: () => void;
}) {
  const router = useRouter();
  const signedIn = useSession((s) => s.user !== null);
  const showToast = useSubscriptions((s) => s.showToast);
  const [state, dispatch] = useReducer(reduceReaction, short, (s) =>
    initialReaction({ reaction: s.reaction, likes: s.likes, dislikes: null }),
  );
  const busy = useRef(false);

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
          body: JSON.stringify({ videoId: short.id, kind }),
        });
        const body = (await res.json().catch(() => ({}))) as Partial<ReactionResult> & { error?: string };
        if (!res.ok || typeof body.likes !== "number") throw new Error(body.error ?? "failed");
        dispatch({ type: "settled", server: { reaction: body.reaction ?? null, likes: body.likes, dislikes: null } });
      } catch (err) {
        const code = err instanceof Error ? err.message : "failed";
        dispatch({ type: "failed", error: code });
        showToast(engagementErrorMessage(code));
      } finally {
        busy.current = false;
      }
    })();
  }, [state, short.id, showToast]);

  const view = viewReaction(state);
  const click = (kind: Reaction) => {
    if (!signedIn) {
      router.push(`/login?next=${encodeURIComponent(`/shorts/${short.id}`)}`);
      return;
    }
    dispatch({ type: "click", kind });
  };
  const off = short.commentsMode === "off";

  return (
    <div className="flex flex-col items-center gap-4" data-short-rail data-reactions={view.reaction ?? "none"}>
      <RailButton
        label={likesOn ? (view.reaction === "like" ? "Unlike" : "I like this") : "Likes aren't on yet."}
        text={likesOn ? shortCount(view.likes) : "Like"}
        on={view.reaction === "like"}
        disabled={!likesOn}
        onClick={() => click("like")}
        data={{ "data-short-like": String(view.likes) }}
      >
        <ThumbUpIcon className="h-6 w-6" />
      </RailButton>
      <RailButton
        label={likesOn ? "I dislike this" : "Likes aren't on yet."}
        text="Dislike"
        on={view.reaction === "dislike"}
        disabled={!likesOn}
        onClick={() => click("dislike")}
        data={{ "data-short-dislike": "" }}
      >
        <ThumbDownIcon className="h-6 w-6" />
      </RailButton>
      <RailButton
        label={off ? "Comments are turned off" : "Comments"}
        text={off ? "Off" : shortCount(short.comments)}
        on={commentsOpen}
        onClick={onComments}
        data={{ "data-short-comments": String(short.comments) }}
      >
        <CommentIcon className="h-6 w-6" />
      </RailButton>
      <RailButton label="Share" text="Share" onClick={onShare} data={{ "data-short-share": "" }}>
        <ShareIcon className="h-6 w-6" />
      </RailButton>
      <a
        href={`/@${short.channel.handle}`}
        aria-label={`Go to ${short.channel.name}`}
        title={short.channel.name}
        data-short-channel-link
        className="mt-1 block rounded-full ring-2 ring-white"
      >
        <Avatar name={short.channel.name} url={short.channel.avatarUrl} size={40} />
      </a>
    </div>
  );
}
