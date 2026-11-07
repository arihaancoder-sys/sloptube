import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminLog } from "@/components/admin/AdminLog";
import { AdminError, AdminShell } from "@/components/admin/AdminShell";
import { adminGate, adminLog } from "@/lib/moderation/server";

export const metadata = { title: "Mod log | sloptube admin", robots: { index: false } };

async function LogGate({ searchParams }: { searchParams: PageProps<"/admin/log">["searchParams"] }) {
  const gate = await adminGate();
  if (gate.kind === "hidden") notFound();
  const params = await searchParams;
  const raw = typeof params.before === "string" ? params.before : null;
  const before = raw && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : null;
  const entries = await adminLog(gate, before);
  return (
    <AdminShell tab="log" title="Mod log" hint="Every moderation action: who, what, on what, and why." preview={gate.kind === "preview"}>
      {"error" in entries ? <AdminError code={entries.error} /> : <AdminLog entries={entries} />}
    </AdminShell>
  );
}

export default function AdminLogPage({ searchParams }: PageProps<"/admin/log">) {
  return (
    <Suspense fallback={null}>
      <LogGate searchParams={searchParams} />
    </Suspense>
  );
}
