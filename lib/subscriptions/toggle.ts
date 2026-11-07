// The Subscribe button's state machine, with optimistic updates.
//
// The button shows what the person asked for (`want`) right away; the server
// state (`server`) only changes when a request comes back. One request runs
// at a time: when it settles, nextOp() compares the two again and sends what
// is still missing, so fast double clicks end in the last state asked for,
// never in a race between two requests. A failed request puts the button back
// to the server state and keeps the error for a message.
// No imports, so Node can load this file directly.

export type SubSnapshot = { subscribed: boolean; notify: boolean; count: number };

export type SubOp = { kind: "subscribe" } | { kind: "unsubscribe" } | { kind: "notify"; on: boolean };

export type ToggleState = {
  server: SubSnapshot;
  want: { subscribed: boolean; notify: boolean };
  inFlight: SubOp | null;
  error: string | null;
};

export type ToggleEvent =
  /** The red or grey button. */
  | { type: "toggle" }
  /** The bell, only while subscribed. */
  | { type: "bell" }
  /** A request went out. */
  | { type: "sent"; op: SubOp }
  /** It came back with the new server state. */
  | { type: "settled"; server: SubSnapshot }
  /** It failed: back to the last server state. */
  | { type: "failed"; error: string }
  /** Fresh values from the page or the guide list, applied only while idle. */
  | { type: "sync"; server: SubSnapshot };

export function initialToggle(server: SubSnapshot): ToggleState {
  return {
    server,
    want: { subscribed: server.subscribed, notify: server.subscribed && server.notify },
    inFlight: null,
    error: null,
  };
}

/** Is there anything the person asked for that the server does not have yet? */
export function isDirty(s: ToggleState): boolean {
  return nextNeeded(s) !== null;
}

function nextNeeded(s: ToggleState): SubOp | null {
  if (s.want.subscribed !== s.server.subscribed) return { kind: s.want.subscribed ? "subscribe" : "unsubscribe" };
  if (s.want.subscribed && s.want.notify !== s.server.notify) return { kind: "notify", on: s.want.notify };
  return null;
}

/** The request to send now, or null while one is running or nothing is left. */
export function nextOp(s: ToggleState): SubOp | null {
  return s.inFlight ? null : nextNeeded(s);
}

export function reduceToggle(s: ToggleState, e: ToggleEvent): ToggleState {
  switch (e.type) {
    case "toggle": {
      const subscribed = !s.want.subscribed;
      // A new subscription starts with the bell on, like the database default.
      return { ...s, want: { subscribed, notify: subscribed }, error: null };
    }
    case "bell":
      if (!s.want.subscribed) return s;
      return { ...s, want: { ...s.want, notify: !s.want.notify }, error: null };
    case "sent":
      return { ...s, inFlight: e.op };
    case "settled":
      return { ...s, server: e.server, inFlight: null };
    case "failed":
      return {
        ...s,
        inFlight: null,
        want: { subscribed: s.server.subscribed, notify: s.server.subscribed && s.server.notify },
        error: e.error,
      };
    case "sync":
      // Never overwrite a click that has not reached the server yet.
      if (s.inFlight || isDirty(s)) return s;
      return { ...initialToggle(e.server), error: s.error };
  }
}

/** What the page shows: the wanted state, with the count moved by the pending change. */
export function viewToggle(s: ToggleState): SubSnapshot {
  const delta = s.want.subscribed === s.server.subscribed ? 0 : s.want.subscribed ? 1 : -1;
  return {
    subscribed: s.want.subscribed,
    notify: s.want.subscribed && s.want.notify,
    count: Math.max(0, s.server.count + delta),
  };
}
