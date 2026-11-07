import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminChannels } from "@/components/admin/AdminChannels";
import { AdminQueue } from "@/components/admin/AdminQueue";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { adminGate, adminQueue, adminSuspended, findChannel, serverNow } from "@/lib/moderation/server";

export const metadata = { title: "Reports | sloptube admin", robots: { index: false } };

async function QueueGate({ searchParams }: { searchParams: PageProps<"/admin">["searchParams"] }) {
  const gate = await adminGate();
  // Not an admin, or the moderation flag off: the page does not exist.
  if (gate.kind === "hidden") notFound();
  const params = await searchParams;
  const query = typeof params.channel === "string" ? params.channel.slice(0, 40) : "";
  const [groups, suspended, found] = await Promise.all([adminQueue(gate), adminSuspended(gate), query ? findChannel(gate, query) : null]);
  const preview = gate.kind === "preview";
  return (
    <AdminShell tab="queue" title="Reports" hint="Open reports grouped by what they point at, appeals first." preview={preview}>
      {"error" in groups ? <AdminError code={groups.error} /> : <AdminQueue groups={groups} now={serverNow()} preview={preview} />}
      <AdminChannels suspended={suspended} found={found} query={query} preview={preview} />
    </AdminShell>
  );
}

/** /admin: the moderation queue. Admins only (profiles.role, set in SQL); a 404 for everyone else. */
export default function AdminPage({ searchParams }: PageProps<"/admin">) {
  return (
    <Suspense fallback={null}>
      <QueueGate searchParams={searchParams} />
    </Suspense>
  );
}
