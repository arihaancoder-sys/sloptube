"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FlagIcon } from "@/components/icons";
import { MenuItem } from "@/components/Menu";
import type { TargetKind } from "@/lib/moderation/rules";
import { useSession } from "@/lib/store/session";
import { ReportDialog } from "./ReportDialog";

/** Sends a signed out visitor to sign in, back to this page after. */
export function useSignInHere() {
  const router = useRouter();
  return () => {
    const here = window.location.pathname + window.location.search;
    router.push(`/login?next=${encodeURIComponent(here)}`);
  };
}

/**
 * "Report" for a three dot menu, and the box it opens. The box lives
 * outside the menu, so the menu can close while it is open.
 */
export function useReport(kind: TargetKind, targetId: string) {
  const [open, setOpen] = useState(false);
  const signedIn = useSession((s) => s.user !== null);
  const signIn = useSignInHere();
  const item = (close: () => void) => (
    <MenuItem
      icon={<FlagIcon className="h-5 w-5" />}
      onClick={() => {
        close();
        if (signedIn) setOpen(true);
        else signIn();
      }}
    >
      <span data-report-open={kind}>Report</span>
    </MenuItem>
  );
  const dialog = open ? <ReportDialog kind={kind} targetId={targetId} onClose={() => setOpen(false)} /> : null;
  return { item, dialog };
}
