"use client";

import { useState } from "react";
import { FlagIcon } from "@/components/icons";
import { useFlag, useSession } from "@/lib/store/session";
import { useSignInHere } from "./ReportMenuItem";
import { ReportDialog } from "./ReportDialog";

/** The flag next to Subscribe on someone else's channel, with the moderation flag on. */
export function ChannelReport({ channelId }: { channelId: string }) {
  const on = useFlag("moderation");
  const signedIn = useSession((s) => s.user !== null);
  const [open, setOpen] = useState(false);
  const signIn = useSignInHere();
  if (!on) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => (signedIn ? setOpen(true) : signIn())}
        aria-label="Report channel"
        title="Report channel"
        className="grid h-9 w-9 place-items-center rounded-full text-icon hover:bg-hover hover:text-text"
        data-report-open="channel"
      >
        <FlagIcon className="h-5 w-5" />
      </button>
      {open && <ReportDialog kind="channel" targetId={channelId} onClose={() => setOpen(false)} />}
    </>
  );
}
