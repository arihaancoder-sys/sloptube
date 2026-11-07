import { create } from "zustand";
import { subErrorMessage, type SubAction } from "@/lib/subscriptions/rules";
import {
  initialToggle,
  isDirty,
  nextOp,
  reduceToggle,
  type SubOp,
  type SubSnapshot,
  type ToggleEvent,
  type ToggleState,
} from "@/lib/subscriptions/toggle";
import type { GuideChannel, SubResult } from "@/lib/subscriptions/types";

/**
 * The signed in person's subscriptions in the browser. One list, read once
 * per page load from /api/subscriptions, feeds the guide and tells every
 * Subscribe button on the page whether it is on. Each button's clicks run
 * through the toggle state machine (lib/subscriptions/toggle.ts), keyed by
 * channel id, so the button and the subscriber count next to it move together.
 */
type SubsState = {
  /** idle: nothing asked yet (signed out or the flag off). */
  status: "idle" | "loading" | "ready" | "error";
  channels: GuideChannel[];
  toggles: Record<string, ToggleState>;
  /** A short message at the bottom left, like the 2019 toast. */
  toast: { id: number; text: string } | null;
  load: () => Promise<void>;
  /** A button on the page: its channel and the count the server rendered. */
  seed: (channelId: string, count: number) => void;
  toggle: (channelId: string) => void;
  bell: (channelId: string) => void;
  showToast: (text: string) => void;
  clearToast: (id: number) => void;
  /** Back to idle, when the person signs out. */
  reset: () => void;
};

function membership(channels: GuideChannel[], channelId: string) {
  const c = channels.find((x) => x.id === channelId);
  return { subscribed: Boolean(c), notify: c?.notify ?? false };
}

function opBody(channelId: string, op: SubOp): { channelId: string; action: SubAction; on?: boolean } {
  return op.kind === "notify" ? { channelId, action: "notify", on: op.on } : { channelId, action: op.kind };
}

let toastId = 0;

export const useSubscriptions = create<SubsState>((set, get) => {
  function dispatch(channelId: string, event: ToggleEvent) {
    const current = get().toggles[channelId];
    if (!current) return;
    set((s) => ({ toggles: { ...s.toggles, [channelId]: reduceToggle(current, event) } }));
  }

  /** Sends whatever the button still needs, one request at a time. */
  async function pump(channelId: string) {
    const state = get().toggles[channelId];
    const op = state && nextOp(state);
    if (!op) return;
    dispatch(channelId, { type: "sent", op });
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(opBody(channelId, op)),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<SubResult> & { error?: string };
      if (!res.ok || typeof body.subscribed !== "boolean") throw new Error(body.error ?? "failed");
      dispatch(channelId, {
        type: "settled",
        server: { subscribed: body.subscribed, notify: body.notify === true, count: Number(body.count) || 0 },
      });
    } catch (err) {
      const code = err instanceof Error ? err.message : "failed";
      dispatch(channelId, { type: "failed", error: code });
      get().showToast(subErrorMessage(code));
      return;
    }
    const after = get().toggles[channelId];
    if (after && isDirty(after)) return pump(channelId);
    if (op.kind === "subscribe") get().showToast("Subscription added");
    if (op.kind === "unsubscribe") get().showToast("Subscription removed");
    // The guide list follows: new channels appear, removed ones go.
    void get().load();
  }

  return {
    status: "idle",
    channels: [],
    toggles: {},
    toast: null,

    load: async () => {
      if (get().status === "idle") set({ status: "loading" });
      try {
        const res = await fetch("/api/subscriptions", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const { channels } = (await res.json()) as { channels: GuideChannel[] };
        set((s) => {
          const toggles = { ...s.toggles };
          for (const [id, t] of Object.entries(toggles)) {
            toggles[id] = reduceToggle(t, { type: "sync", server: { ...membership(channels, id), count: t.server.count } });
          }
          return { status: "ready", channels, toggles };
        });
      } catch {
        set((s) => ({ status: s.status === "ready" ? "ready" : "error" }));
      }
    },

    seed: (channelId, count) => {
      const { toggles, channels, status } = get();
      const known = status === "ready" ? membership(channels, channelId) : { subscribed: false, notify: false };
      const server: SubSnapshot = { ...known, count };
      const existing = toggles[channelId];
      set({ toggles: { ...toggles, [channelId]: existing ? reduceToggle(existing, { type: "sync", server }) : initialToggle(server) } });
    },

    toggle: (channelId) => {
      dispatch(channelId, { type: "toggle" });
      void pump(channelId);
    },

    bell: (channelId) => {
      dispatch(channelId, { type: "bell" });
      const t = get().toggles[channelId];
      if (t?.want.subscribed) get().showToast(t.want.notify ? "You'll get notifications for new uploads" : "Notifications turned off");
      void pump(channelId);
    },

    showToast: (text) => set({ toast: { id: ++toastId, text } }),
    clearToast: (id) => set((s) => (s.toast?.id === id ? { toast: null } : s)),

    reset: () => set({ status: "idle", channels: [], toggles: {} }),
  };
});
