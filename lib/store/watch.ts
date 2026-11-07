import { create } from "zustand";
import { loadTheater, saveTheater } from "@/lib/watch/prefs";

type WatchState = {
  /** Theater mode: the player spans the whole width above the two columns. */
  theater: boolean;
  /** Where the player is, in whole seconds, for "Start at" in the share box. */
  currentTime: number;
  /** Reads the remembered theater setting once the page is in the browser. */
  syncTheater: () => void;
  toggleTheater: () => void;
  setCurrentTime: (t: number) => void;
};

export const useWatch = create<WatchState>((set, get) => ({
  theater: false,
  currentTime: 0,
  syncTheater: () => set({ theater: loadTheater() }),
  toggleTheater: () => {
    const theater = !get().theater;
    saveTheater(theater);
    set({ theater });
  },
  setCurrentTime: (t) => {
    const s = Math.floor(t);
    if (s !== get().currentTime) set({ currentTime: s });
  },
}));
