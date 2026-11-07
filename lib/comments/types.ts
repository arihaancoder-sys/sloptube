// What the comments routes and the watch page hand to the browser. Nothing
// here is secret: no author ids, no emails. Only relative imports, so Node
// can load this file directly.

import { isMode, type CommentsMode, type CommentSort } from "./rules.ts";

export type CommentAuthor = { handle: string; name: string; avatarUrl: string | null };

export type Comment = {
  id: string;
  videoId: string;
  parentId: string | null;
  /** null once deleted. */
  body: string | null;
  likes: number;
  /** Replies that are not deleted. */
  replyCount: number;
  pinned: boolean;
  hearted: boolean;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  /** Deleted by moderation (016): the placeholder says so. */
  removed?: boolean;
  /** null once deleted. */
  author: CommentAuthor | null;
  /** Written by the video's owner. */
  byOwner: boolean;
  /** Written by the viewer. */
  mine: boolean;
  liked: boolean;
  /** Only in the browser: the optimistic row while "Posting...". */
  pending?: boolean;
  /** Only in the browser: posted from this page, so it shows even with the replies folded. */
  local?: boolean;
};

/** A row from list_comments(), list_replies(), comments_since() or post_comment(). */
export type CommentRow = {
  id: string;
  video_id: string;
  parent_id: string | null;
  body: string | null;
  like_count: number | string | null;
  reply_count: number | string | null;
  pinned: boolean | null;
  hearted: boolean | null;
  created_at: string;
  edited_at: string | null;
  deleted: boolean | null;
  author_handle: string | null;
  author_name: string | null;
  author_avatar_url: string | null;
  by_owner: boolean | null;
  mine: boolean | null;
  liked: boolean | null;
  /** From 016 on. */
  removed?: boolean | null;
};

function count(v: number | string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function rowToComment(row: CommentRow): Comment {
  const deleted = row.deleted === true;
  return {
    id: row.id,
    videoId: row.video_id,
    parentId: row.parent_id ?? null,
    body: deleted ? null : (row.body ?? ""),
    likes: count(row.like_count),
    replyCount: count(row.reply_count),
    pinned: row.pinned === true,
    hearted: row.hearted === true,
    createdAt: row.created_at,
    editedAt: row.edited_at ?? null,
    deleted,
    removed: deleted && row.removed === true,
    author:
      deleted || !row.author_handle
        ? null
        : { handle: row.author_handle, name: row.author_name || row.author_handle, avatarUrl: row.author_avatar_url ?? null },
    byOwner: row.by_owner === true,
    mine: row.mine === true,
    liked: row.liked === true,
  };
}

/** One page of top level comments or replies. `next` is the cursor for the page after. */
export type CommentsPage = { comments: Comment[]; next: string | null };

/** What the watch page starts with, server rendered. */
export type CommentsInitial = {
  count: number;
  mode: CommentsMode;
  isOwner: boolean;
  signedIn: boolean;
  sort: CommentSort;
  page: CommentsPage;
  /** The newest top level comment's cursor, for the "new comments" poll. */
  since: string | null;
  /** The server's clock, so "2 days ago" reads the same before and after hydration. */
  now: number;
};

export function toMode(v: unknown): CommentsMode {
  return isMode(v) ? v : "on";
}

/** A comment on /studio/comments: which video it is under, and the comment. */
export type StudioComment = Comment & { videoTitle: string };

export type StudioRow = Omit<CommentRow, "deleted" | "mine" | "liked"> & { video_title: string; channel_default: string | null };

export function rowToStudioComment(row: StudioRow): StudioComment {
  return {
    ...rowToComment({ ...row, deleted: false, mine: row.by_owner, liked: false }),
    videoTitle: row.video_title,
  };
}
