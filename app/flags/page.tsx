import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getFlags } from "@/lib/flags";

export const metadata = { title: "Feature flags | sloptube" };

const DASHBOARD = "https://supabase.com/dashboard/project/_/editor";

/** Dev only: on with `next dev`, or in production when FLAGS_PAGE=1. */
function flagsPageEnabled() {
  const env = process.env;
  return env.NODE_ENV !== "production" || env["FLAGS_PAGE"] === "1";
}

const modeStyle: Record<string, string> = {
  off: "bg-hover text-text-2",
  test: "bg-[#fff4e5] text-[#a75b00] dark:bg-[#3a2a12] dark:text-[#ffb74d]",
  everyone: "bg-[#e6f4ea] text-[#137333] dark:bg-[#12301c] dark:text-[#81c995]",
};

async function FlagList() {
  await connection();
  if (!flagsPageEnabled()) notFound();
  const { source, flags } = await getFlags();

  return (
    <>
      {source === "fallback" && (
        <p className="mb-4 rounded-sm bg-hover px-4 py-3 text-[14px] text-text-2">
          The flags table could not be read (database not connected, or migration 001 not
          applied). Showing the built in defaults.
        </p>
      )}
      <div className="overflow-x-auto bg-surface">
        <table className="w-full min-w-[560px] text-left text-[14px]">
          <thead className="border-b border-divider text-[12px] uppercase text-text-2">
            <tr>
              <th className="px-4 py-3 font-medium">Key</th>
              <th className="px-4 py-3 font-medium">Feature</th>
              <th className="px-4 py-3 font-medium">Mode</th>
              <th className="px-4 py-3 font-medium">Test users</th>
            </tr>
          </thead>
          <tbody>
            {flags.map((flag) => (
              <tr key={flag.key} className="border-b border-divider last:border-0">
                <td className="px-4 py-3 font-mono text-[13px]">{flag.key}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{flag.label || flag.key}</div>
                  {flag.description && <div className="text-[13px] text-text-2">{flag.description}</div>}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-sm px-2 py-1 text-[12px] font-medium uppercase ${modeStyle[flag.mode]}`}>
                    {flag.mode}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-2">{flag.users.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function FlagsPage() {
  return (
    <div className="mx-auto max-w-[960px] px-4 py-6 sm:px-6">
      <h1 className="text-[20px] leading-7">Feature flags</h1>
      <p className="mb-6 mt-1 text-[14px] text-text-2">
        Read only. Change a flag in the{" "}
        <a className="link" href={DASHBOARD}>
          Supabase table editor
        </a>{" "}
        (table <code>feature_flags</code>), then reload.
      </p>
      <Suspense fallback={<p className="text-text-2">Loading flags</p>}>
        <FlagList />
      </Suspense>
    </div>
  );
}
