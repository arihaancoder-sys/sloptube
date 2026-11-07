import type { ReactNode } from "react";
import { ChannelMessage } from "../channel/ChannelNotices";

/** A full page message, same look as the channel ones. */
export function UploadMessage({ state, title, children }: { state: string; title: string; children?: ReactNode }) {
  return (
    <div data-upload-state={state}>
      <ChannelMessage state={state} title={title}>
        {children}
      </ChannelMessage>
    </div>
  );
}

export function UploadsOff({ noDb = false }: { noDb?: boolean }) {
  return (
    <UploadMessage state="off" title="Uploads aren't on yet">
      Uploading is switched off right now. Check back soon.
      {noDb && <span className="mt-2 block text-text-3">database not connected</span>}
    </UploadMessage>
  );
}

export function UploadSkeleton() {
  return (
    <div aria-hidden className="px-0 py-0 sm:px-6 sm:py-6">
      <div className="mx-auto h-[560px] max-w-[960px] bg-surface sm:rounded-[4px]" />
    </div>
  );
}
