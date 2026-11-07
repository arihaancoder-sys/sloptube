import { create } from "zustand";
import { applyTheme, readTheme, type Theme } from "@/lib/theme";

/** Width where the full 240 px guide shows by default (same as YouTube). */
export const WIDE_GUIDE_PX = 1313;

type UiState = {
  /** Overlay guide, used below 1313 px. */
  drawerOpen: boolean;
  /** On wide screens: show the 72 px icon rail instead of the full guide. */
  guideMini: boolean;
  theme: Theme;
  /**
   * True while the creator studio's own left nav is on screen (feature 12):
   * the guide does not dock then, and the hamburger opens it as a drawer.
   */
  studioNav: boolean;
  setStudioNav: (on: boolean) => void;
  /** The hamburger: collapses the guide on wide screens, opens the drawer otherwise. */
  toggleGuide: () => void;
  closeDrawer: () => void;
  syncTheme: () => void;
  setTheme: (theme: Theme) => void;
};

export const useUi = create<UiState>((set) => ({
  drawerOpen: false,
  guideMini: false,
  theme: "light",
  studioNav: false,
  setStudioNav: (on) => set({ studioNav: on }),
  toggleGuide: () =>
    set((s) =>
      // The watch page and the studio never dock the guide, so the hamburger always opens the drawer there.
      window.innerWidth >= WIDE_GUIDE_PX && window.location.pathname !== "/watch" && !s.studioNav
        ? { guideMini: !s.guideMini, drawerOpen: false }
        : { drawerOpen: !s.drawerOpen },
    ),
  closeDrawer: () => set({ drawerOpen: false }),
  syncTheme: () => set({ theme: readTheme() }),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
}));
