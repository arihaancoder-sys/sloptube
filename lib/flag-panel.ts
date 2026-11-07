// Feature 17: the flag panel. Pure logic shared by the panel, the API route
// and the tests. No imports on purpose, so `node --test` can load it directly.

import type { FlagMode } from "./flags-core";

/** The flags in the panel, in the order of the demo (docs/launch.md, "Flags cheat sheet"). */
export type PanelFlag = { key: string; label: string; n: number | null };

export const PANEL_FLAGS: readonly PanelFlag[] = [
  { n: 1, key: "accounts", label: "Accounts" },
  { n: 2, key: "channels", label: "Channels" },
  { n: 3, key: "upload", label: "Upload" },
  { n: 4, key: "processing", label: "Processing" },
  { n: 5, key: "watch", label: "Watch page" },
  { n: 6, key: "feed", label: "Home feed" },
  { n: 7, key: "subscriptions", label: "Subscriptions" },
  { n: 8, key: "search", label: "Search" },
  { n: 9, key: "engagement", label: "Likes and views" },
  { n: 10, key: "comments", label: "Comments" },
  { n: 11, key: "shorts", label: "Snips" },
  { n: 12, key: "studio", label: "Creator studio" },
  { n: 13, key: "stats", label: "Stats" },
  { n: 14, key: "moderation", label: "Moderation" },
  { n: 15, key: "launch", label: "Launch pack" },
  { n: 16, key: "yapin", label: "Yapin'" },
  { n: null, key: "maintenance", label: "Maintenance" },
];

/** The flag that shows the panel itself. Not in the list: switching it off from inside would hide the panel. */
export const PANEL_FLAG_KEY = "flag_panel";

/** What one switch shows. "me" is test mode with the admin listed; "test" is test mode without them (set by hand). */
export type PanelChoice = "off" | "me" | "everyone" | "test";

export const CHOICES: readonly { choice: Extract<PanelChoice, "off" | "me" | "everyone">; label: string; mode: FlagMode }[] = [
  { choice: "off", label: "Off", mode: "off" },
  { choice: "me", label: "Me", mode: "test" },
  { choice: "everyone", label: "Everyone", mode: "everyone" },
];

export type PanelFlagState = { mode: FlagMode; mine: boolean };

/** The switch position for a flag row. */
export function choiceOf(state: PanelFlagState | undefined): PanelChoice | null {
  if (!state) return null;
  if (state.mode === "off") return "off";
  if (state.mode === "everyone") return "everyone";
  return state.mine ? "me" : "test";
}

/** The mode a switch position asks the database for. */
export function modeOfChoice(choice: Extract<PanelChoice, "off" | "me" | "everyone">): FlagMode {
  return choice === "me" ? "test" : choice;
}

/** Off > Me > Everyone > Off, for the keyboard. */
export function nextChoice(choice: PanelChoice | null): Extract<PanelChoice, "off" | "me" | "everyone"> {
  if (choice === "off") return "me";
  if (choice === "me" || choice === "test") return "everyone";
  return "off";
}

/** Ctrl+Shift+S, or Cmd+Shift+S on a Mac. Alt is left out so Ctrl+Alt+Shift+S stays free. */
export function isPanelShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "s";
}

export const ERROR_CODES = ["not_signed_in", "not_admin", "bad_mode", "not_found", "no_db", "flag_panel_off", "not_set_up", "bad_request"] as const;

/** The code raised by set_feature_flag, or "failed" for anything else. */
export function flagPanelErrorCode(message: string | null | undefined): string {
  const m = (message ?? "").trim();
  if ((ERROR_CODES as readonly string[]).includes(m)) return m;
  if (/permission denied/i.test(m)) return "not_signed_in";
  return "failed";
}

export function flagPanelErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case "not_signed_in":
      return "Sign in again.";
    case "not_admin":
      return "Admins only.";
    case "bad_mode":
      return "Not a mode.";
    case "not_found":
      return "No such flag. Apply its migration first.";
    case "no_db":
      return "Database not connected.";
    case "flag_panel_off":
      return "The flag_panel flag is off.";
    case "not_set_up":
      return "Migration 020 is not applied yet.";
    default:
      return "Something went wrong. Try again.";
  }
}

export function flagPanelStatus(code: string): number {
  switch (code) {
    case "not_signed_in":
      return 401;
    case "flag_panel_off":
      return 403;
    case "not_admin":
    case "not_found":
      return 404;
    case "bad_mode":
    case "bad_request":
      return 400;
    case "no_db":
    case "not_set_up":
      return 503;
    default:
      return 500;
  }
}
