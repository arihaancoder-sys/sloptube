// What /auth/yapin does with the Yapin' user it got back. Yapin' shares no
// email address (scope identify only), so there are three ways in: sign in
// the account already linked to this Yapin' id, link the signed in account
// (Settings > Connections), or make a new account. Never by email.
// Pure, so the tests can walk every case. Only type imports.
import type { YapinMode } from "./state.ts";

/** A row from yapin_find_user(yapin_id) in 019: the account linked to this Yapin' id. */
export type FoundUser = { user_id: string; email: string | null };

export type LinkDecision =
  /** Sign in this account (already linked). */
  | { do: "signin"; userId: string; email: string }
  /** Make a new account (placeholder email, see placeholderEmail), link it, sign it in. */
  | { do: "create" }
  /** Link the signed in account (Settings > Connections). */
  | { do: "link"; userId: string }
  /** Nothing to change: the signed in account is already linked to this Yapin' user. */
  | { do: "already"; userId: string }
  /** A note code for ?yapin= (see yapinNote in rules.ts). */
  | { do: "refuse"; note: "taken" | "error" };

export function decideLink(mode: YapinMode, found: FoundUser[], currentUid: string | null): LinkDecision {
  const linked = found[0] ?? null;

  if (mode === "link") {
    if (!currentUid) return { do: "refuse", note: "error" };
    if (linked) return linked.user_id === currentUid ? { do: "already", userId: currentUid } : { do: "refuse", note: "taken" };
    return { do: "link", userId: currentUid };
  }

  if (linked) {
    if (!linked.email) return { do: "refuse", note: "error" };
    return { do: "signin", userId: linked.user_id, email: linked.email };
  }
  return { do: "create" };
}
