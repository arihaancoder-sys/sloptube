"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import {
  ArrowDropDownIcon,
  ArrowDropUpIcon,
  DeleteIcon,
  EditIcon,
  FlagIcon,
  HeartIcon,
  MoreIcon,
  PinIcon,
  ThumbDownIcon,
  ThumbUpIcon,
} from "@/components/icons";
import { Menu, MenuItem } from "@/components/Menu";
import { useReport } from "@/components/moderation/ReportMenuItem";
import { mentionPrefix, viewRepliesLabel } from "@/lib/comments/rules";
import type { Comment, CommentAuthor } from "@/lib/comments/types";
import { useComments } from "@/lib/store/comments";
import { useFlag } from "@/lib/store/session";
import { useSubscriptions } from "@/lib/store/subscriptions";
import { shortCount, timeAgo } from "@/lib/watch/format";
import { CommentBody } from "./CommentBody";
import { CommentBox } from "./CommentBox";

/** What every comment row needs to know about the page. */
export type CommentContext = {
  isOwner: boolean;
  signedIn: boolean;
  /** The viewer, as a comment author (null signed out). */
  viewer: CommentAuthor | null;
  channel: { name: string; avatarUrl: string | null };
  now: number;
  /** Signed out, the buttons send people here. */
  signIn: () => void;
};

const action = "flex h-8 items-center gap-1.5 rounded-sm px-2 text-[13px] text-text-2";

/** The creator's heart: their picture with a small red heart on it. */
function CreatorHeart({ channel, onClick }: { channel: CommentContext["channel"]; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      data-creator-heart
      title={`❤ by ${channel.name}`}
      aria-label={`Hearted by ${channel.name}`}
      className="relative ml-1 grid h-8 w-8 place-items-center"
    >
      <Avatar name={channel.name} url={channel.avatarUrl} size={16} />
      <HeartIcon className="absolute bottom-[5px] right-[3px] h-[11px] w-[11px] text-[#ff0000] drop-shadow-[0_0_1px_var(--surface)]" />
    </button>
  );
}

function DeleteDialog({ onCancel, onDelete, mine }: { onCancel: () => void; onDelete: () => void; mine: boolean }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" role="dialog" aria-modal aria-label="Delete comment">
      <div className="w-full max-w-[400px] rounded-sm bg-surface p-6" style={{ boxShadow: "var(--menu-shadow)" }}>
        <h2 className="text-[16px] font-medium text-text">Delete comment</h2>
        <p className="mt-3 text-[14px] leading-5 text-text-2">
          {mine ? "Delete your comment permanently?" : "Delete this comment from your video permanently?"}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn-text" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-text !text-link" onClick={onDelete} data-confirm-delete>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One comment in the 2019 layout: avatar, name and time, the text, then the
 * thumbs, REPLY and the creator's heart, the three dot menu on the right.
 * Top level comments also carry their replies ("View N replies").
 */
export function CommentItem({ comment, ctx, parentId = null }: { comment: Comment; ctx: CommentContext; parentId?: string | null }) {
  const isReply = parentId !== null;
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const like = useComments((s) => s.like);
  const post = useComments((s) => s.post);
  const edit = useComments((s) => s.edit);
  const remove = useComments((s) => s.remove);
  const moderate = useComments((s) => s.moderate);
  const showToast = useSubscriptions((s) => s.showToast);
  const moderation = useFlag("moderation");
  const report = useReport("comment", comment.id);

  const size = isReply ? 24 : 40;
  const author = comment.author;
  const pending = comment.pending === true;
  const canDelete = !pending && !comment.deleted && (comment.mine || ctx.isOwner);
  const signedInOr = (fn: () => void) => () => (ctx.signedIn ? fn() : ctx.signIn());

  const startReply = signedInOr(() => setReplying(true));
  const replyTo = parentId ?? comment.id;

  return (
    <div
      className={`group/comment flex gap-4 ${isReply ? "mt-3" : "mt-4"}`}
      data-comment={comment.id}
      data-comment-kind={isReply ? "reply" : "top"}
      data-pending={pending ? "1" : undefined}
      data-pinned={comment.pinned ? "1" : undefined}
      data-hearted={comment.hearted ? "1" : undefined}
    >
      <div className="shrink-0">
        {author ? (
          <Link href={`/@${author.handle}`} aria-label={author.name}>
            <Avatar name={author.name} url={author.avatarUrl} size={size} />
          </Link>
        ) : (
          <span className="block rounded-full bg-skeleton" style={{ width: size, height: size }} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {comment.pinned && (
          <p className="mb-0.5 flex items-center gap-1 text-[12px] leading-[18px] text-text-2" data-pinned-badge>
            <PinIcon className="h-4 w-4" />
            Pinned by {ctx.channel.name}
          </p>
        )}

        {comment.deleted ? (
          <p className="py-1 text-[14px] leading-5 text-text-2" data-comment-deleted={comment.removed ? "removed" : "deleted"}>
            {comment.removed ? "This comment was removed by moderation." : "This comment was deleted."}
          </p>
        ) : (
          <>
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 text-[13px] leading-[18px]">
                {author && (
                  <Link
                    href={`/@${author.handle}`}
                    className={`mr-1 font-medium text-text ${comment.byOwner ? "rounded-full bg-[var(--sub-bg)] px-1.5 py-px" : ""}`}
                    data-comment-author
                  >
                    {author.name}
                  </Link>
                )}
                <span className="text-text-2" data-comment-time>
                  {pending ? "Posting..." : timeAgo(comment.createdAt, ctx.now)}
                  {comment.editedAt && !pending ? " (edited)" : ""}
                </span>
              </p>
              {!pending && !editing && (
                <div className="-mr-2 -mt-1.5 opacity-100 transition-opacity tab:opacity-0 tab:group-hover/comment:opacity-100 tab:focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100" data-comment-menu>
                  <Menu
                    label="Comment actions"
                    width={200}
                    button={<MoreIcon className="h-5 w-5" />}
                    buttonClassName="grid h-8 w-8 place-items-center rounded-full text-icon hover:bg-hover"
                  >
                    {(close) => (
                      <>
                        {ctx.isOwner && !isReply && (
                          <MenuItem
                            icon={<PinIcon className="h-5 w-5" />}
                            onClick={() => {
                              close();
                              void moderate(comment.id, comment.pinned ? "unpin" : "pin");
                            }}
                          >
                            {comment.pinned ? "Unpin" : "Pin"}
                          </MenuItem>
                        )}
                        {ctx.isOwner && (
                          <MenuItem
                            icon={<HeartIcon className="h-5 w-5" />}
                            onClick={() => {
                              close();
                              void moderate(comment.id, comment.hearted ? "unheart" : "heart");
                            }}
                          >
                            {comment.hearted ? "Remove heart" : "Heart"}
                          </MenuItem>
                        )}
                        {comment.mine && (
                          <MenuItem
                            icon={<EditIcon className="h-5 w-5" />}
                            onClick={() => {
                              close();
                              setEditing(true);
                            }}
                          >
                            Edit
                          </MenuItem>
                        )}
                        {canDelete && (
                          <MenuItem
                            icon={<DeleteIcon className="h-5 w-5" />}
                            onClick={() => {
                              close();
                              setConfirming(true);
                            }}
                          >
                            Delete
                          </MenuItem>
                        )}
                        {!comment.mine &&
                          (moderation ? (
                            report.item(close)
                          ) : (
                            <MenuItem
                              icon={<FlagIcon className="h-5 w-5" />}
                              onClick={() => {
                                close();
                                showToast("Reporting arrives with moderation.");
                              }}
                            >
                              Report
                            </MenuItem>
                          ))}
                      </>
                    )}
                  </Menu>
                </div>
              )}
            </div>

            <div className="mt-0.5">
              {editing ? (
                <div className="mt-2">
                  <CommentBox
                    avatarName={null}
                    initial={comment.body ?? ""}
                    submitLabel="Save"
                    autoFocus
                    alwaysOpen
                    onCancel={() => setEditing(false)}
                    onSubmit={async (body) => {
                      const ok = await edit(comment.id, body);
                      if (ok) setEditing(false);
                      return ok;
                    }}
                  />
                </div>
              ) : (
                <CommentBody text={comment.body ?? ""} />
              )}
            </div>

            {!editing && (
              <div className={`-ml-2 mt-1 flex items-center ${pending ? "pointer-events-none opacity-50" : ""}`}>
                <button
                  type="button"
                  onClick={signedInOr(() => void like(comment.id))}
                  aria-label="Like"
                  aria-pressed={comment.liked}
                  data-comment-like
                  data-on={comment.liked ? "1" : undefined}
                  className={`${action} hover:text-text`}
                >
                  <ThumbUpIcon className={`h-4 w-4 ${comment.liked ? "text-link" : "text-icon"}`} />
                  <span data-comment-likes>{comment.likes > 0 ? shortCount(comment.likes) : ""}</span>
                </button>
                {/* The dislike is only a button, like 2019: no count anywhere. */}
                <DislikeButton signedIn={ctx.signedIn} signIn={ctx.signIn} />
                <button
                  type="button"
                  onClick={startReply}
                  className={`${action} ml-1 font-medium uppercase hover:text-text`}
                  data-comment-reply
                >
                  Reply
                </button>
                {comment.hearted && (
                  <CreatorHeart
                    channel={ctx.channel}
                    onClick={ctx.isOwner ? () => void moderate(comment.id, "unheart") : undefined}
                  />
                )}
              </div>
            )}
          </>
        )}

        {replying && ctx.viewer && (
          <div className="mt-2" data-reply-box>
            <CommentBox
              avatarName={ctx.viewer.name}
              avatarUrl={ctx.viewer.avatarUrl}
              size={24}
              placeholder="Add a public reply..."
              submitLabel="Reply"
              initial={isReply ? mentionPrefix(author?.handle) : ""}
              autoFocus
              alwaysOpen
              onCancel={() => setReplying(false)}
              onSubmit={async (body) => {
                setReplying(false);
                return post(body, replyTo, ctx.viewer!, ctx.isOwner);
              }}
            />
          </div>
        )}

        {!isReply && <Replies comment={comment} ctx={ctx} />}
      </div>

      {report.dialog}
      {confirming && (
        <DeleteDialog
          mine={comment.mine}
          onCancel={() => setConfirming(false)}
          onDelete={() => {
            setConfirming(false);
            void remove(comment.id);
          }}
        />
      )}
    </div>
  );
}

function DislikeButton({ signedIn, signIn }: { signedIn: boolean; signIn: () => void }) {
  const [on, setOn] = useState(false);
  return (
    <button
      type="button"
      onClick={() => (signedIn ? setOn(!on) : signIn())}
      aria-label="Dislike"
      aria-pressed={on}
      data-comment-dislike
      className={`${action} hover:text-text`}
    >
      <ThumbDownIcon className={`h-4 w-4 ${on ? "text-link" : "text-icon"}`} />
    </button>
  );
}

/** "View N replies" and the replies under it, with the line that joins them to the comment. */
function Replies({ comment, ctx }: { comment: Comment; ctx: CommentContext }) {
  const state = useComments((s) => s.thread.replies[comment.id]);
  const loading = useComments((s) => s.loadingReplies[comment.id] === true);
  const load = useComments((s) => s.loadReplies);
  const hide = useComments((s) => s.hideReplies);

  const open = state?.open === true;
  const items = state?.items ?? [];
  const shown = open ? items : items.filter((c) => c.pending || c.local);
  if (comment.replyCount === 0 && shown.length === 0) return null;
  const remaining = Math.max(0, comment.replyCount - items.filter((c) => !c.pending && !c.local).length);

  return (
    <div data-replies={comment.id} data-replies-open={open ? "1" : "0"}>
      {comment.replyCount > 0 && (
        <button
          type="button"
          onClick={() => (open ? hide(comment.id) : void load(comment.id))}
          className="-ml-2 mt-1 flex h-9 items-center gap-1 rounded-sm px-2 text-[14px] font-medium text-link hover:bg-hover"
          data-view-replies
        >
          {open ? <ArrowDropUpIcon className="h-6 w-6" /> : <ArrowDropDownIcon className="h-6 w-6" />}
          {open ? (comment.replyCount === 1 ? "Hide reply" : `Hide ${comment.replyCount.toLocaleString("en-US")} replies`) : viewRepliesLabel(comment.replyCount)}
        </button>
      )}
      {shown.length > 0 && (
        <div className="relative pl-4" data-reply-thread>
          {/* The line joining the replies to the comment. */}
          <span aria-hidden className="absolute bottom-3 left-[3px] top-1 w-0.5 rounded-full bg-divider" data-reply-line />
          {shown.map((r) => (
            <CommentItem key={r.id} comment={r} ctx={ctx} parentId={comment.id} />
          ))}
        </div>
      )}
      {open && loading && (
        <div className="ml-4 mt-3 h-5 w-5 animate-spin rounded-full border-2 border-divider border-t-text-2" data-replies-loading />
      )}
      {open && !loading && state?.next && remaining > 0 && (
        <button
          type="button"
          onClick={() => void load(comment.id)}
          className="mt-1 flex h-9 items-center gap-1 rounded-sm px-2 text-[14px] font-medium text-link hover:bg-hover"
          data-more-replies
        >
          <ArrowDropDownIcon className="h-6 w-6" />
          Show more replies
        </button>
      )}
    </div>
  );
}
