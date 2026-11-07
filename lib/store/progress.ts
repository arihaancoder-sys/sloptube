import { create } from "zustand";
import { PROGRESS_BATCH } from "@/lib/engagement/rules";

/**
 * How far the signed in viewer got in each video, 0 to 1, for the red bars
 * under thumbnails. Cards ask for their own id with want(); the ids are
 * gathered for a moment and read in one request per 100 from
 * /api/history/progress. The player and the history page put what they
 * already know straight in with put().
 */
type ProgressState = {
  map: Record<string, number>;
  want: (id: string) => void;
  put: (entries: Record<string, number>) => void;
  /** After "Clear all watch history". */
  clear: () => void;
};

const asked = new Set<string>();
let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

export const useProgress = create<ProgressState>((set, get) => {
  async function flush() {
    timer = undefined;
    const ids = queue;
    queue = [];
    for (let i = 0; i < ids.length; i += PROGRESS_BATCH) {
      const some = ids.slice(i, i + PROGRESS_BATCH);
      try {
        const res = await fetch("/api/history/progress", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: some }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { progress?: Record<string, number> };
        if (body.progress) get().put(body.progress);
      } catch {
        // No bars this time; ask again on the next page load.
        for (const id of some) asked.delete(id);
      }
    }
  }

  return {
    map: {},
    want: (id) => {
      if (asked.has(id)) return;
      asked.add(id);
      queue.push(id);
      timer ??= setTimeout(() => void flush(), 30);
    },
    put: (entries) => {
      for (const id of Object.keys(entries)) asked.add(id);
      set((s) => ({ map: { ...s.map, ...entries } }));
    },
    clear: () => set({ map: {} }),
  };
});
