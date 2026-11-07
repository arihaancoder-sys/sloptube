// The like and dislike buttons' state, with optimistic updates, the same way
// as the Subscribe button (lib/subscriptions/toggle.ts): the buttons show
// what the person asked for (`want`) at once, one request runs at a time,
// and when it settles nextReaction() sends whatever is still missing. A
// failed request goes back to the server state and keeps the error.
// No imports, so Node can load this file directly.

import type { Reaction } from "./rules.ts";

export type ReactionSnapshot = {
  reaction: Reaction | null;
  likes: number;
  /** Only the owner gets the dislike count; null for everybody else. */
  dislikes: number | null;
};

export type ReactionState = {
  server: ReactionSnapshot;
  want: Reaction | null;
  inFlight: boolean;
  error: string | null;
};

export type ReactionEvent =
  /** A click on the like or the dislike thumb. */
  | { type: "click"; kind: Reaction }
  | { type: "sent" }
  | { type: "settled"; server: ReactionSnapshot }
  | { type: "failed"; error: string };

export function initialReaction(server: ReactionSnapshot): ReactionState {
  return { server, want: server.reaction, inFlight: false, error: null };
}

/** Clicking the thumb that is on turns it off; the other one switches over. */
export function clicked(current: Reaction | null, kind: Reaction): Reaction | null {
  return current === kind ? null : kind;
}

export function reduceReaction(s: ReactionState, e: ReactionEvent): ReactionState {
  switch (e.type) {
    case "click":
      return { ...s, want: clicked(s.want, e.kind), error: null };
    case "sent":
      return { ...s, inFlight: true };
    case "settled":
      return { ...s, server: e.server, inFlight: false };
    case "failed":
      return { ...s, inFlight: false, want: s.server.reaction, error: e.error };
  }
}

/**
 * The reaction to send now, or undefined while a request runs or when the
 * server already has what the person wants. null means "clear it".
 */
export function nextReaction(s: ReactionState): Reaction | null | undefined {
  if (s.inFlight || s.want === s.server.reaction) return undefined;
  return s.want;
}

/** What the buttons show: the wanted reaction, with the counts moved by it. */
export function viewReaction(s: ReactionState): ReactionSnapshot {
  const delta = (k: Reaction) => (s.want === k ? 1 : 0) - (s.server.reaction === k ? 1 : 0);
  return {
    reaction: s.want,
    likes: Math.max(0, s.server.likes + delta("like")),
    dislikes: s.server.dislikes === null ? null : Math.max(0, s.server.dislikes + delta("dislike")),
  };
}

/** The 2019 like bar under the thumbs: the share of likes, 0 to 1, or null without dislikes. */
export function likeRatio(v: ReactionSnapshot): number | null {
  if (v.dislikes === null) return null;
  const total = v.likes + v.dislikes;
  return total === 0 ? null : v.likes / total;
}
