"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { DeleteIcon, HeartIcon, PinIcon } from "@/components/icons";
import { commentsErrorMessage, type CommentsMode } from "@/lib/comments/rules";
import type { StudioComment } from "@/lib/comments/types";
import { useSubscriptions } from "@/lib/store/subscriptions";
import { timeAgo } from "@/lib/watch/format";
import { CommentBody } from "./CommentBody";

const MODES: { value: CommentsMode; label: string }[] = [
  { value: "on", label: "Allow all comments" },
  { value: "held", label: "Hold all for review (arrives with moderation)" },
  { value: "off", label: "Turn comments off" },
];

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { error?: string; mode?: CommentsMode };
  if (!res.ok || json.error) throw new Error(json.error ?? "failed");
  return json;
}

/** /studio/comments: the latest comments on the owner's videos, with heart and delete. */
export function StudioComments({ comments, channelDefault, now }: { comments: StudioComment[]; channelDefault: CommentsMode; now: number }) {
  const [list, setList] = useState(comments);
  const [mode, setMode] = useState(channelDefault);
  const showToast = useSubscriptions((s) => s.showToast);
  const fail = (err: unknown) => showToast(commentsErrorMessage(err instanceof Error ? err.message : "failed"));

  const heart = async (c: StudioComment) => {
    const on = !c.hearted;
    setList((l) => l.map((x) => (x.id === c.id ? { ...x, hearted: on } : x)));
    try {
      await send("/api/comments/moderate", "POST", { id: c.id, action: on ? "heart" : "unheart" });
    } catch (err) {
      setList((l) => l.map((x) => (x.id === c.id ? { ...x, hearted: !on } : x)));
      fail(err);
    }
  };
  const remove = async (c: StudioComment) => {
    try {
      await send("/api/comments", "DELETE", { id: c.id });
      setList((l) => l.filter((x) => x.id !== c.id));
      showToast("Comment deleted");
    } catch (err) {
      fail(err);
    }
  };
  const changeMode = async (next: CommentsMode) => {
    const before = mode;
    setMode(next);
    try {
      await send("/api/comments/settings", "POST", { mode: next });
      showToast("Saved. New videos and videos without their own setting follow it.");
    } catch (err) {
      setMode(before);
      fail(err);
    }
  };

  return (
    <div>
      <label className="mb-6 flex flex-wrap items-center gap-3 text-[14px] text-text">
        <span className="font-medium">Comments on your videos</span>
        <select
          value={mode}
          onChange={(e) => void changeMode(e.target.value as CommentsMode)}
          className="h-9 rounded-sm border border-[var(--input-border)] bg-[var(--input-bg)] px-2 text-[14px] text-text"
          data-channel-comments-mode
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      {list.length === 0 ? (
        <p className="rounded-sm border border-divider bg-surface px-4 py-6 text-center text-[14px] text-text-2" data-studio-comments-empty>
          No comments on your videos yet.
        </p>
      ) : (
        <ul className="divide-y divide-divider rounded-sm border border-divider bg-surface">
          {list.map((c) => (
            <li key={c.id} className="flex gap-4 px-4 py-4" data-studio-comment={c.id}>
              <Avatar name={c.author?.name ?? "?"} url={c.author?.avatarUrl} size={40} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-[18px]">
                  <span className="mr-1 font-medium text-text">{c.author?.name}</span>
                  <span className="text-text-2">
                    {timeAgo(c.createdAt, now)}
                    {c.parentId ? " · reply" : ""}
                    {c.pinned ? " · pinned" : ""}
                  </span>
                </p>
                <div className="mt-0.5">
                  <CommentBody text={c.body ?? ""} />
                </div>
                <p className="mt-1 truncate text-[12px] text-text-2">
                  on{" "}
                  <Link href={`/watch?v=${c.videoId}`} className="text-link">
                    {c.videoTitle}
                  </Link>
                </p>
              </div>
              <div className="flex shrink-0 items-start gap-1">
                {c.pinned && <PinIcon className="mt-2 h-4 w-4 text-icon" />}
                <button
                  type="button"
                  onClick={() => void heart(c)}
                  aria-pressed={c.hearted}
                  aria-label={c.hearted ? "Remove heart" : "Heart"}
                  title={c.hearted ? "Remove heart" : "Heart"}
                  data-studio-heart
                  className="grid h-9 w-9 place-items-center rounded-full hover:bg-hover"
                >
                  <HeartIcon className={`h-5 w-5 ${c.hearted ? "text-[#ff0000]" : "text-icon"}`} />
                </button>
                <button
                  type="button"
                  onClick={() => void remove(c)}
                  aria-label="Delete"
                  title="Delete"
                  data-studio-delete
                  className="grid h-9 w-9 place-items-center rounded-full hover:bg-hover"
                >
                  <DeleteIcon className="h-5 w-5 text-icon" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
