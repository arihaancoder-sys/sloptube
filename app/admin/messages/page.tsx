import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminMessages } from "@/components/admin/AdminMessages";
import { AdminShell } from "@/components/admin/AdminShell";
import { launchErrorMessage } from "@/lib/launch/rules";
import { adminMessages } from "@/lib/launch/server";
import { serverNow } from "@/lib/moderation/server";

export const metadata = { title: "Messages | sloptube admin", robots: { index: false } };

async function MessagesGate({ searchParams }: { searchParams: PageProps<"/admin/messages">["searchParams"] }) {
  const all = (await searchParams).all === "1";
  const state = await adminMessages(all);
  if (state.kind === "hidden") notFound();
  return (
    <AdminShell tab="messages" title="Messages" hint="What people sent with the contact form, newest first." preview={state.preview}>
      {state.kind === "off" ? (
        <p className="rounded-[2px] bg-surface px-4 py-6 text-center text-[14px] text-text-2" data-admin-error="launch_off">
          The contact form is behind the <code>launch</code> flag. Switch it on to collect messages.
        </p>
      ) : state.kind === "error" ? (
        <p className="rounded-[2px] bg-surface px-4 py-6 text-center text-[14px] text-text-2" data-admin-error={state.code}>
          {launchErrorMessage(state.code)}
        </p>
      ) : (
        <AdminMessages messages={state.messages} now={serverNow()} preview={state.preview} all={all} />
      )}
    </AdminShell>
  );
}

/** /admin/messages: the contact form's inbox. Admins only; a 404 for everyone else. */
export default function AdminMessagesPage({ searchParams }: PageProps<"/admin/messages">) {
  return (
    <Suspense fallback={null}>
      <MessagesGate searchParams={searchParams} />
    </Suspense>
  );
}
