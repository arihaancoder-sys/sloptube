import { create } from "zustand";
import { commentsErrorMessage, POLL_MS, type CommentSort } from "@/lib/comments/rules";
import {
  addPending,
  appendPage,
  dropPending,
  findComment,
  initialThread,
  patchComment,
  receivePoll,
  receiveReplies,
  removeComment,
  resolvePending,
  setPinned,
  showHeld,
  toggleReplies,
  type ThreadState,
} from "@/lib/comments/thread";
import type { Comment, CommentAuthor, CommentsInitial, CommentsPage } from "@/lib/comments/types";
import { useSubscriptions } from "./subscriptions";

/**
 * The comments section under the watch page. The list logic lives in
 * lib/comments/thread.ts; this store only fetches and hands the answers to it.
 * One section per page, so one store: init() starts it over for a new video.
 */
type CommentsState = {
  videoId: string | null;
  sort: CommentSort;
  thread: ThreadState;
  loadingMore: boolean;
  /** Replies being fetched, by parent id. */
  loadingReplies: Record<string, boolean>;
  init: (videoId: string, initial: CommentsInitial) => void;
  setSort: (sort: CommentSort) => Promise<void>;
  loadMore: () => Promise<void>;
  poll: () => Promise<void>;
  showNew: () => void;
  loadReplies: (parentId: string) => Promise<void>;
  hideReplies: (parentId: string) => void;
  post: (body: string, parentId: string | null, author: CommentAuthor, byOwner: boolean) => Promise<boolean>;
  edit: (id: string, body: string) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  like: (id: string) => Promise<void>;
  moderate: (id: string, action: "pin" | "unpin" | "heart" | "unheart") => Promise<void>;
};

const empty: ThreadState = { count: 0, top: [], next: null, held: [], since: null, replies: {} };

function toast(code: string) {
  useSubscriptions.getState().showToast(commentsErrorMessage(code));
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init && { ...init, headers: { "content-type": "application/json" } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok || body.error) throw new Error(body.error ?? "failed");
  return body;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const codeOf = (err: unknown) => (err instanceof Error ? err.message : "failed");

let tempCounter = 0;

export const useComments = create<CommentsState>((set, get) => {
  /** Change the thread only if the section still shows the same video. */
  const update = (videoId: string | null, fn: (t: ThreadState) => ThreadState) => {
    if (get().videoId === videoId) set((s) => ({ thread: fn(s.thread) }));
  };

  return {
    videoId: null,
    sort: "top",
    thread: empty,
    loadingMore: false,
    loadingReplies: {},

    init(videoId, initial) {
      set({ videoId, sort: initial.sort, thread: initialThread(initial.count, initial.page, initial.since), loadingMore: false, loadingReplies: {} });
    },

    async setSort(sort) {
      const { videoId } = get();
      if (!videoId || sort === get().sort) return;
      set({ sort, loadingMore: true, thread: { ...get().thread, top: [], next: null } });
      try {
        const page = await call<CommentsPage>(`/api/comments?v=${videoId}&sort=${sort}`);
        if (get().sort === sort) update(videoId, (t) => ({ ...t, top: page.comments, next: page.next }));
      } catch (err) {
        toast(codeOf(err));
      } finally {
        set({ loadingMore: false });
      }
    },

    async loadMore() {
      const { videoId, sort, thread, loadingMore } = get();
      if (!videoId || loadingMore || !thread.next) return;
      set({ loadingMore: true });
      try {
        const page = await call<CommentsPage>(`/api/comments?v=${videoId}&sort=${sort}&cursor=${encodeURIComponent(thread.next)}`);
        if (get().sort === sort) update(videoId, (t) => appendPage(t, page));
      } catch {
        // The sentinel asks again when it comes back into view.
      } finally {
        set({ loadingMore: false });
      }
    },

    // Live updates: every POLL_MS the page asks for top level comments newer
    // than the newest it knows. When the Yapin' realtime channel arrives
    // (feature 16), a subscription to new rows for this video calls
    // receivePoll() with each row instead, and this poll goes away.
    async poll() {
      const { videoId, thread } = get();
      if (!videoId) return;
      try {
        const q = `/api/comments?v=${videoId}&since=${encodeURIComponent(thread.since ?? "")}`;
        const { comments } = await call<{ comments: Comment[] }>(q);
        if (comments.length) update(videoId, (t) => receivePoll(t, comments));
      } catch {
        // Quiet: the next poll tries again.
      }
    },

    showNew() {
      set((s) => ({ thread: showHeld(s.thread) }));
    },

    async loadReplies(parentId) {
      const { videoId, thread, loadingReplies } = get();
      if (!videoId || loadingReplies[parentId]) return;
      const cur = thread.replies[parentId];
      // Opened before and nothing more to fetch: just show them again.
      if (cur?.loaded && cur.open === false) {
        set((s) => ({ thread: toggleReplies(s.thread, parentId, true) }));
        return;
      }
      if (cur?.loaded && !cur.next) return;
      set((s) => ({ loadingReplies: { ...s.loadingReplies, [parentId]: true }, thread: toggleReplies(s.thread, parentId, true) }));
      try {
        const cursor = cur?.loaded && cur.next ? `&cursor=${encodeURIComponent(cur.next)}` : "";
        const page = await call<CommentsPage>(`/api/comments/replies?parent=${parentId}${cursor}`);
        update(videoId, (t) => receiveReplies(t, parentId, page));
      } catch (err) {
        toast(codeOf(err));
      } finally {
        set((s) => ({ loadingReplies: { ...s.loadingReplies, [parentId]: false } }));
      }
    },

    hideReplies(parentId) {
      set((s) => ({ thread: toggleReplies(s.thread, parentId, false) }));
    },

    async post(body, parentId, author, byOwner) {
      const { videoId } = get();
      if (!videoId) return false;
      const tempId = `pending-${++tempCounter}`;
      const now = new Date().toISOString();
      const row: Comment = {
        id: tempId,
        videoId,
        parentId,
        body,
        likes: 0,
        replyCount: 0,
        pinned: false,
        hearted: false,
        createdAt: now,
        editedAt: null,
        deleted: false,
        author,
        byOwner,
        mine: true,
        liked: false,
      };
      update(videoId, (t) => addPending(t, row));
      try {
        const { comment } = await call<{ comment: Comment }>("/api/comments", json("POST", { videoId, body, parentId }));
        update(videoId, (t) => resolvePending(t, tempId, comment));
        return true;
      } catch (err) {
        update(videoId, (t) => dropPending(t, tempId));
        toast(codeOf(err));
        return false;
      }
    },

    async edit(id, body) {
      const { videoId } = get();
      try {
        const { comment } = await call<{ comment: Comment }>("/api/comments", json("PATCH", { id, body }));
        update(videoId, (t) => patchComment(t, id, (c) => ({ ...c, body: comment.body, editedAt: comment.editedAt })));
        return true;
      } catch (err) {
        toast(codeOf(err));
        return false;
      }
    },

    async remove(id) {
      const { videoId } = get();
      try {
        await call("/api/comments", json("DELETE", { id }));
        update(videoId, (t) => removeComment(t, id));
        useSubscriptions.getState().showToast("Comment deleted");
      } catch (err) {
        toast(codeOf(err));
      }
    },

    async like(id) {
      const { videoId, thread } = get();
      const c = findComment(thread, id);
      if (!c || c.pending || c.deleted) return;
      const on = !c.liked;
      const flip = (x: Comment) => ({ ...x, liked: on, likes: Math.max(0, x.likes + (on ? 1 : -1)) });
      update(videoId, (t) => patchComment(t, id, flip));
      try {
        const r = await call<{ liked: boolean; likes: number }>("/api/comments/like", json("POST", { id, on }));
        update(videoId, (t) => patchComment(t, id, (x) => ({ ...x, liked: r.liked, likes: r.likes })));
      } catch (err) {
        update(videoId, (t) => patchComment(t, id, (x) => ({ ...x, liked: c.liked, likes: c.likes })));
        toast(codeOf(err));
      }
    },

    async moderate(id, action) {
      const { videoId, thread } = get();
      const before = thread;
      const apply = (t: ThreadState) =>
        action === "pin" || action === "unpin"
          ? setPinned(t, id, action === "pin")
          : patchComment(t, id, (c) => ({ ...c, hearted: action === "heart" }));
      update(videoId, apply);
      try {
        await call("/api/comments/moderate", json("POST", { id, action }));
        if (action === "pin") useSubscriptions.getState().showToast("Comment pinned");
      } catch (err) {
        update(videoId, () => before);
        toast(codeOf(err));
      }
    },
  };
});

export { POLL_MS };
